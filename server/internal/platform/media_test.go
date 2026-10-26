package platform

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"hash/crc32"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func mediaFixture(t *testing.T) (*App, *memoryStore, http.Handler) {
	t.Helper()
	a, s, _ := fixture(t)
	a.cfg.MediaDirectory = filepath.Join(t.TempDir(), "media")
	if err := PrepareMediaDirectory(a.cfg.MediaDirectory); err != nil {
		t.Fatal(err)
	}
	return a, s, a.Handler()
}
func testMediaPNG(t *testing.T) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, 12, 7))
	img.Set(2, 3, color.NRGBA{R: 80, G: 110, B: 240, A: 255})
	var output bytes.Buffer
	if err := png.Encode(&output, img); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}
func multipartMedia(t *testing.T, raw []byte, clientID string, extra bool) ([]byte, string) {
	t.Helper()
	var buffer bytes.Buffer
	writer := multipart.NewWriter(&buffer)
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", `form-data; name="file"; filename="untrusted.svg"`)
	header.Set("Content-Type", "application/x-untrusted")
	file, err := writer.CreatePart(header)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = file.Write(raw); err != nil {
		t.Fatal(err)
	}
	if err = writer.WriteField("clientId", clientID); err != nil {
		t.Fatal(err)
	}
	if extra {
		if err = writer.WriteField("extra", "forbidden"); err != nil {
			t.Fatal(err)
		}
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes(), writer.FormDataContentType()
}
func uploadMedia(t *testing.T, h http.Handler, raw []byte, clientID string, cookie *http.Cookie) response {
	t.Helper()
	body, contentType := multipartMedia(t, raw, clientID, false)
	r := httptest.NewRequest("POST", "http://localhost:8080/api/v1/media/images", bytes.NewReader(body))
	r.Header.Set("Content-Type", contentType)
	r.Header.Set("Origin", "http://localhost:5173")
	if cookie != nil {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	var result struct {
		Data  json.RawMessage `json:"data"`
		Error *APIError       `json:"error"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("invalid media response %d %s", w.Code, w.Body)
	}
	return response{Code: w.Code, Data: result.Data, Error: result.Error}
}
func readMedia(t *testing.T, h http.Handler, method, url string, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(method, "http://localhost:8080"+url, nil)
	if cookie != nil {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
func TestMediaReencodingIdempotencyAndPrivateReads(t *testing.T) {
	a, s, h := mediaFixture(t)
	cookie, admin := memberCookie(t, h), adminCookie(t, h)
	raw := append(testMediaPNG(t), []byte("private-metadata-marker")...)
	first := uploadMedia(t, h, raw, "media-first-client", cookie)
	requireCode(t, first, 200)
	asset := payload[MediaAsset](t, first)
	if !mediaIDPattern.MatchString(asset.ID) || asset.URL != mediaURLPrefix+asset.ID || asset.ContentType != "image/png" || asset.Width != 12 || asset.Height != 7 {
		t.Fatalf("bad asset: %+v", asset)
	}
	repeated := uploadMedia(t, h, raw, "media-first-client", cookie)
	requireCode(t, repeated, 200)
	if !bytes.Equal(first.Data, repeated.Data) || len(s.state.Media) != 1 {
		t.Fatal("upload retry changed its full response or created a duplicate")
	}
	requireCode(t, uploadMedia(t, h, testMediaPNG(t), "media-first-client", cookie), 409)
	for _, session := range []*http.Cookie{cookie, admin} {
		imageResponse := readMedia(t, h, "GET", asset.URL, session)
		if imageResponse.Code != 200 || imageResponse.Header().Get("Content-Type") != "image/png" || imageResponse.Header().Get("Cache-Control") != "no-store" || bytes.Contains(imageResponse.Body.Bytes(), []byte("private-metadata-marker")) {
			t.Fatal("normalized authenticated image response invalid")
		}
		config, _, err := image.DecodeConfig(imageResponse.Body)
		if err != nil || config.Width != 12 || config.Height != 7 {
			t.Fatal("served bytes are not a safe image")
		}
	}
	if readMedia(t, h, "GET", asset.URL, nil).Code != 404 {
		t.Fatal("unpublished private media leaked anonymously")
	}
	head := readMedia(t, h, "HEAD", asset.URL, cookie)
	if head.Code != 200 || head.Body.Len() != 0 || head.Header().Get("Content-Length") == "" {
		t.Fatal("HEAD did not preserve image headers without bytes")
	}
	rangeRequest := httptest.NewRequest("GET", "http://localhost:8080"+asset.URL, nil)
	rangeRequest.AddCookie(cookie)
	rangeRequest.Header.Set("Range", "bytes=999999999-")
	rangeResponse := httptest.NewRecorder()
	h.ServeHTTP(rangeResponse, rangeRequest)
	if rangeResponse.Code != 416 || rangeResponse.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("range error dropped dynamic-media cache protection")
	}
	entries, _ := os.ReadDir(a.cfg.MediaDirectory)
	if len(entries) != 1 || entries[0].Name() != asset.ID+".png" {
		t.Fatal("unexpected upload path or leftovers")
	}
	info, err := os.Stat(filepath.Join(a.cfg.MediaDirectory, entries[0].Name()))
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("media file is not private")
	}
	requireCode(t, call(t, h, "DELETE", "/media/images/"+asset.ID, nil, admin), 404)
	requireCode(t, call(t, h, "DELETE", "/media/images/"+asset.ID, nil, cookie), 200)
	requireCode(t, call(t, h, "DELETE", "/media/images/"+asset.ID, nil, cookie), 200)
	if readMedia(t, h, "GET", asset.URL, cookie).Code != 404 {
		t.Fatal("deleted media remained readable")
	}
	entries, _ = os.ReadDir(a.cfg.MediaDirectory)
	if len(entries) != 0 {
		t.Fatal("deleted file was not cleaned")
	}
	requireCode(t, uploadMedia(t, h, raw, "media-first-client", cookie), 409)
}

func TestMediaPostReferencesAndModerationLifecycle(t *testing.T) {
	_, s, h := mediaFixture(t)
	cookie, admin := memberCookie(t, h), adminCookie(t, h)
	asset := payload[MediaAsset](t, uploadMedia(t, h, testMediaPNG(t), "media-moderation-client", cookie))
	create := func(session *http.Cookie, images []string) response {
		return call(t, h, "POST", "/posts", map[string]any{"body": "托管图片审核测试", "images": images}, session)
	}
	first := create(cookie, []string{asset.URL, asset.URL})
	requireCode(t, first, 200)
	p := payload[Post](t, first)
	if p.Status != "pending" || len(p.Images) != 1 {
		t.Fatal("hosted-image post bypassed initial moderation or deduplication")
	}
	second := create(cookie, []string{asset.URL})
	requireCode(t, second, 200)
	p2 := payload[Post](t, second)
	requireCode(t, create(admin, []string{asset.URL}), 400)
	for _, url := range []string{asset.URL + "?bypass=1", asset.URL + "/extra", "/api/v1/other", "http://localhost:5173" + asset.URL} {
		requireCode(t, create(cookie, []string{url}), 400)
	}
	legacy := create(cookie, []string{"https://example.org/legacy.jpg"})
	requireCode(t, legacy, 200)
	if payload[Post](t, legacy).Status != "published" {
		t.Fatal("legacy HTTP image compatibility changed")
	}
	requireCode(t, call(t, h, "DELETE", "/media/images/"+asset.ID, nil, cookie), 409)
	if readMedia(t, h, "GET", asset.URL, nil).Code != 404 {
		t.Fatal("pending references opened anonymous media")
	}
	requireCode(t, call(t, h, "PATCH", "/admin/posts/"+p.ID, map[string]string{"status": "published"}, admin), 200)
	if readMedia(t, h, "GET", asset.URL, nil).Code != 200 {
		t.Fatal("published reference did not open media")
	}
	page := payload[struct {
		Items []AdminMediaAsset
		Total int
	}](t, call(t, h, "GET", "/admin/media?q="+p.ID, nil, admin))
	if page.Total != 1 || page.Items[0].ReferenceCount != 2 || page.Items[0].PublishedReferenceCount != 1 || len(page.Items[0].Posts) != 2 {
		t.Fatal("staff reference lookup/counts incomplete")
	}
	requireCode(t, call(t, h, "GET", "/admin/media", nil, cookie), 403)
	requireCode(t, call(t, h, "GET", "/admin/media?status=deleted", nil, admin), 400)
	requireCode(t, call(t, h, "PATCH", "/admin/media/"+asset.ID, map[string]string{"status": "blocked", "note": ""}, admin), 400)
	requireCode(t, call(t, h, "PATCH", "/admin/media/"+asset.ID, map[string]string{"status": "blocked", "note": "审核不通过"}, admin), 200)
	if s.state.Posts[p.ID].Status != "hidden" || s.state.Posts[p2.ID].Status != "pending" {
		t.Fatal("block did not hide only the published references")
	}
	for _, session := range []*http.Cookie{cookie, nil} {
		if readMedia(t, h, "GET", asset.URL, session).Code != 404 {
			t.Fatal("blocked media leaked to ordinary reader")
		}
	}
	if readMedia(t, h, "GET", asset.URL, admin).Code != 200 {
		t.Fatal("staff cannot inspect blocked media")
	}
	requireCode(t, create(cookie, []string{asset.URL}), 400)
	requireCode(t, call(t, h, "PATCH", "/admin/posts/"+p.ID, map[string]string{"status": "published"}, admin), 409)
	audits := len(s.state.Audits)
	requireCode(t, call(t, h, "PATCH", "/admin/media/"+asset.ID, map[string]string{"status": "blocked", "note": "补充说明"}, admin), 200)
	if len(s.state.Audits) != audits+1 {
		t.Fatal("same-status note update not audited")
	}
	requireCode(t, call(t, h, "PATCH", "/admin/media/"+asset.ID, map[string]string{"status": "ready", "note": "复核恢复"}, admin), 200)
	if s.state.Posts[p.ID].Status != "hidden" || readMedia(t, h, "GET", asset.URL, nil).Code != 404 {
		t.Fatal("unblocking automatically restored a hidden post")
	}
	requireCode(t, call(t, h, "PATCH", "/admin/posts/"+p2.ID, map[string]string{"status": "published"}, admin), 200)
	requireCode(t, call(t, h, "DELETE", "/posts/"+p2.ID, nil, cookie), 200)
	if readMedia(t, h, "GET", asset.URL, nil).Code != 404 {
		t.Fatal("deleted last published reference kept image public")
	}
}

func TestMediaInputLimitsAndUnsupportedFormats(t *testing.T) {
	a, _, h := mediaFixture(t)
	cookie := memberCookie(t, h)
	oversizedDimensions := append([]byte{}, testMediaPNG(t)...)
	binary.BigEndian.PutUint32(oversizedDimensions[16:20], 8193)
	binary.BigEndian.PutUint32(oversizedDimensions[29:33], crc32.ChecksumIEEE(oversizedDimensions[12:29]))
	var animation bytes.Buffer
	if err := gif.Encode(&animation, image.NewPaletted(image.Rect(0, 0, 1, 1), color.Palette{color.Black}), nil); err != nil {
		t.Fatal(err)
	}
	for index, test := range []struct {
		raw    []byte
		status int
	}{
		{[]byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>bad</script></svg>`), 400},
		{animation.Bytes(), 400}, {[]byte("fake JPEG"), 400}, {testMediaPNG(t)[:40], 400},
		{oversizedDimensions, 400}, {make([]byte, mediaMaxBytes+1), 413},
	} {
		requireCode(t, uploadMedia(t, h, test.raw, strings.Repeat("x", 8)+string(rune('a'+index)), cookie), test.status)
	}
	tooManyPixels := append([]byte{}, testMediaPNG(t)...)
	binary.BigEndian.PutUint32(tooManyPixels[16:20], 5000)
	binary.BigEndian.PutUint32(tooManyPixels[20:24], 4000)
	binary.BigEndian.PutUint32(tooManyPixels[29:33], crc32.ChecksumIEEE(tooManyPixels[12:29]))
	requireCode(t, uploadMedia(t, h, tooManyPixels, "pixel-limit-client", cookie), 400)
	body, contentType := multipartMedia(t, testMediaPNG(t), "extra-part-client", true)
	r := httptest.NewRequest("POST", "http://localhost:8080/api/v1/media/images", bytes.NewReader(body))
	r.AddCookie(cookie)
	r.Header.Set("Origin", "http://localhost:5173")
	r.Header.Set("Content-Type", contentType)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 400 {
		t.Fatal("extra multipart field accepted")
	}
	requireCode(t, uploadMedia(t, h, testMediaPNG(t), "short", cookie), 400)
	requireCode(t, uploadMedia(t, h, testMediaPNG(t), "anonymous-client", nil), 401)
	r = httptest.NewRequest("POST", "http://localhost:8080/api/v1/media/images", bytes.NewReader(body))
	r.AddCookie(cookie)
	r.Header.Set("Content-Type", contentType)
	r.Header.Set("Origin", "https://evil.example")
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("upload bypassed Origin guard")
	}
	// Standard JPEG is accepted based on actual bytes despite an untrusted name/MIME.
	var jpegData bytes.Buffer
	if err := jpeg.Encode(&jpegData, image.NewRGBA(image.Rect(0, 0, 3, 5)), nil); err != nil {
		t.Fatal(err)
	}
	res := uploadMedia(t, h, jpegData.Bytes(), "jpeg-safe-client", cookie)
	requireCode(t, res, 200)
	if payload[MediaAsset](t, res).ContentType != "image/jpeg" {
		t.Fatal("JPEG MIME detection incorrect")
	}
	largeValid := append(testMediaPNG(t), make([]byte, 2*1024*1024)...)
	requireCode(t, uploadMedia(t, h, largeValid, "larger-than-json-limit", cookie), 200)
	// Admission rejects before reading the body and does not allocate another raw buffer.
	for index := 0; index < cap(a.media.uploads); index++ {
		a.media.uploads <- struct{}{}
	}
	probe := &mediaReadProbe{}
	r = httptest.NewRequest("POST", "http://localhost:8080/api/v1/media/images", probe)
	r.AddCookie(cookie)
	r.Header.Set("Origin", "http://localhost:5173")
	r.Header.Set("Content-Type", contentType)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	for index := 0; index < cap(a.media.uploads); index++ {
		<-a.media.uploads
	}
	if w.Code != 429 || probe.reads != 0 || w.Header().Get("Retry-After") == "" {
		t.Fatal("admission did not reject before multipart buffering")
	}
	writer := &mediaBoundedWriter{}
	_, _ = writer.Write(make([]byte, mediaMaxBytes))
	if _, err := writer.Write([]byte{1}); err == nil {
		t.Fatal("encoded output limit absent")
	}
}

type mediaReadProbe struct{ reads int }

func (p *mediaReadProbe) Read([]byte) (int, error) { p.reads++; return 0, io.EOF }

type mediaFailureStore struct {
	*memoryStore
	commitButFail bool
}

type mediaDelayedCommitStore struct {
	*memoryStore
	pending *State
}

func (s *mediaDelayedCommitStore) Update(ctx context.Context, fn func(*State) error) error {
	return s.memoryStore.Read(ctx, func(snapshot *State) error {
		if err := fn(snapshot); err != nil {
			return err
		}
		s.pending = snapshot
		return errors.New("commit acknowledgement lost while commit still pending")
	})
}
func TestMediaUnknownCommitRetainsFileBeforeRowBecomesVisible(t *testing.T) {
	a, s, h := mediaFixture(t)
	cookie := memberCookie(t, h)
	delayed := &mediaDelayedCommitStore{memoryStore: s}
	a.store = delayed
	requireCode(t, uploadMedia(t, h, testMediaPNG(t), "delayed-commit-client", cookie), 500)
	files, err := os.ReadDir(a.cfg.MediaDirectory)
	if err != nil || len(files) != 1 || len(s.state.Media) != 0 || delayed.pending == nil {
		t.Fatal("ambiguous pending commit lost its private file or prematurely exposed row")
	}
	// The still-finishing original transaction commits after the caller received
	// an error. A negative read before this point cannot justify deleting bytes.
	s.mu.Lock()
	s.state = delayed.pending
	s.mu.Unlock()
	a.store = s
	res := uploadMedia(t, h, testMediaPNG(t), "delayed-commit-client", cookie)
	requireCode(t, res, 200)
	asset := payload[MediaAsset](t, res)
	if readMedia(t, h, "GET", asset.URL, cookie).Code != 200 {
		t.Fatal("later committed row references a removed file")
	}
}

func (s *mediaFailureStore) Update(ctx context.Context, fn func(*State) error) error {
	if s.commitButFail {
		if err := s.memoryStore.Update(ctx, fn); err != nil {
			return err
		}
		return errors.New("simulated lost commit acknowledgement")
	}
	return s.memoryStore.Read(ctx, func(state *State) error {
		if err := fn(state); err != nil {
			return err
		}
		return conflict("simulated rejected operation before commit")
	})
}
func TestMediaFileCompensationAndSymlinkSafety(t *testing.T) {
	a, s, h := mediaFixture(t)
	cookie := memberCookie(t, h)
	raw := testMediaPNG(t)
	a.store = &mediaFailureStore{memoryStore: s}
	requireCode(t, uploadMedia(t, h, raw, "compensation-rejected", cookie), 409)
	files, _ := os.ReadDir(a.cfg.MediaDirectory)
	if len(files) != 0 || len(s.state.Media) != 0 {
		t.Fatal("failed metadata transaction retained candidate file")
	}
	a.store = &mediaFailureStore{memoryStore: s, commitButFail: true}
	requireCode(t, uploadMedia(t, h, raw, "compensation-ambiguous", cookie), 500)
	files, _ = os.ReadDir(a.cfg.MediaDirectory)
	if len(files) != 1 || len(s.state.Media) != 1 {
		t.Fatal("ambiguous committed row lost its file")
	}
	a.store = s
	retry := uploadMedia(t, h, raw, "compensation-ambiguous", cookie)
	requireCode(t, retry, 200)
	asset := payload[MediaAsset](t, retry)
	// A failing delete transaction must never remove the committed original.
	a.store = &mediaFailureStore{memoryStore: s}
	requireCode(t, call(t, h, "DELETE", "/media/images/"+asset.ID, nil, cookie), 409)
	if _, err := os.Stat(filepath.Join(a.cfg.MediaDirectory, asset.ID+".png")); err != nil {
		t.Fatal("failed DB deletion removed its file")
	}
	a.store = s
	outside := filepath.Join(t.TempDir(), "outside.png")
	if err := os.WriteFile(outside, raw, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(a.cfg.MediaDirectory, asset.ID+".png")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(a.cfg.MediaDirectory, asset.ID+".png")); err != nil {
		t.Fatal(err)
	}
	if readMedia(t, h, "GET", asset.URL, cookie).Code != 503 {
		t.Fatal("symlink file escaped private root")
	}
	symlink := filepath.Join(t.TempDir(), "root-link")
	if err := os.Symlink(a.cfg.MediaDirectory, symlink); err != nil {
		t.Fatal(err)
	}
	if PrepareMediaDirectory(symlink) == nil {
		t.Fatal("symbolic root accepted")
	}
	a.cfg.MediaDirectory = filepath.Join(t.TempDir(), "missing")
	requireCode(t, uploadMedia(t, h, raw, "failed-file-create", cookie), 503)
	if len(s.state.Media) != 1 {
		t.Fatal("file write failure committed media metadata")
	}
}

func TestMediaConfigDisabledAndAccountQuota(t *testing.T) {
	if PrepareMediaDirectory(string(os.PathSeparator)) == nil {
		t.Fatal("filesystem root accepted as media storage")
	}
	shared := filepath.Join(t.TempDir(), "shared")
	if err := os.Mkdir(shared, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(shared, 0755); err != nil {
		t.Fatal(err)
	}
	if PrepareMediaDirectory(shared) == nil {
		t.Fatal("existing shared directory accepted")
	}
	if info, err := os.Stat(shared); err != nil || info.Mode().Perm() != 0755 {
		t.Fatal("preparation changed permissions on a shared directory")
	}
	if (Config{Environment: "production", CookieSecure: true, Origins: []string{"https://example.org"}}).Validate() == nil {
		t.Fatal("production accepted missing media directory")
	}
	_, _, disabled := fixture(t)
	cookie := memberCookie(t, disabled)
	requireCode(t, uploadMedia(t, disabled, testMediaPNG(t), "disabled-media-client", cookie), 503)
	a, s, h := mediaFixture(t)
	cookie = memberCookie(t, h)
	now := time.Now()
	for index := 0; index < mediaAccountCount; index++ {
		id := newID("media_")
		s.state.Media[id] = StoredMediaAsset{MediaAsset: MediaAsset{ID: id, URL: mediaURLPrefix + id, ContentType: "image/png", Width: 1, Height: 1, Bytes: 1, CreatedAt: now}, OwnerID: "user_demo", Status: "blocked"}
	}
	requireCode(t, uploadMedia(t, h, testMediaPNG(t), "count-quota-client", cookie), 409)
	files, _ := os.ReadDir(a.cfg.MediaDirectory)
	if len(files) != 0 {
		t.Fatal("quota rejection retained file")
	}
	s.state.Media = map[string]StoredMediaAsset{}
	for index := 0; index < 13; index++ {
		id := newID("media_")
		size := mediaMaxBytes
		if index == 12 {
			size = 4 * 1024 * 1024
		}
		s.state.Media[id] = StoredMediaAsset{MediaAsset: MediaAsset{ID: id, URL: mediaURLPrefix + id, ContentType: "image/png", Width: 1, Height: 1, Bytes: size, CreatedAt: now}, OwnerID: "user_demo", Status: "ready"}
	}
	requireCode(t, uploadMedia(t, h, testMediaPNG(t), "byte-quota-client", cookie), 409)
}
