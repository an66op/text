package platform

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"syscall"
)

// PrepareMediaDirectory must be called before serving configured media storage.
// The directory belongs exclusively to this application, with no static route.
func PrepareMediaDirectory(path string) error {
	if path == "" {
		return nil
	}
	if !filepath.IsAbs(path) {
		return errors.New("media directory must be absolute")
	}
	clean := filepath.Clean(path)
	if clean == filepath.VolumeName(clean)+string(os.PathSeparator) {
		return errors.New("filesystem root cannot be media storage")
	}
	if info, err := os.Lstat(path); err == nil && (!info.IsDir() || info.Mode()&os.ModeSymlink != 0) {
		return errors.New("media directory must be a real private directory")
	} else if err == nil && info.Mode().Perm()&0077 != 0 {
		return errors.New("existing media directory must already be private (0700), permissions are never changed")
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.MkdirAll(path, 0700); err != nil {
		return err
	}
	root, err := mediaRoot(path)
	if err != nil {
		return err
	}
	defer root.Close()
	name := newID("probe_")
	file, err := root.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return fmt.Errorf("media storage write probe: %w", err)
	}
	if err = file.Close(); err != nil {
		_ = root.Remove(name)
		return err
	}
	return root.Remove(name)
}

func mediaRoot(path string) (*os.Root, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0077 != 0 {
		return nil, errors.New("media directory is not private")
	}
	return os.OpenRoot(path)
}
func writeMediaFile(path string, v StoredMediaAsset, raw []byte) error {
	root, err := mediaRoot(path)
	if err != nil {
		return err
	}
	defer root.Close()
	name := mediaFilename(v)
	f, err := root.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	complete := false
	defer func() {
		_ = f.Close()
		if !complete {
			_ = root.Remove(name)
		}
	}()
	if _, err = f.Write(raw); err != nil {
		return err
	}
	if err = f.Sync(); err != nil {
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	if err = syncMediaDirectory(root); err != nil {
		return err
	}
	complete = true
	return nil
}
func openMediaFile(path string, v StoredMediaAsset) (*os.File, error) {
	root, err := mediaRoot(path)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	file, err := root.OpenFile(mediaFilename(v), os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() != v.Bytes {
		_ = file.Close()
		return nil, errors.New("media file missing, replaced or truncated")
	}
	return file, nil
}
func removeMediaFile(path string, v StoredMediaAsset) error {
	if !mediaIDPattern.MatchString(v.ID) {
		return errors.New("invalid media file identity")
	}
	root, err := mediaRoot(path)
	if err != nil {
		return err
	}
	defer root.Close()
	err = root.Remove(mediaFilename(v))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	return syncMediaDirectory(root)
}

func syncMediaDirectory(root *os.Root) error {
	directory, err := root.Open(".")
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}

func parseMediaMultipart(r *http.Request) ([]byte, string, error) {
	reader, err := r.MultipartReader()
	if err != nil {
		return nil, "", &APIError{415, "unsupported_media_type", "请使用multipart/form-data上传JPEG或PNG"}
	}
	var file []byte
	clientID := ""
	seen := map[string]bool{}
	for count := 0; ; count++ {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, "", mediaReadError(err)
		}
		if count >= 2 {
			_ = part.Close()
			return nil, "", bad("仅允许file和clientId两个上传字段")
		}
		name := part.FormName()
		if (name != "file" && name != "clientId") || seen[name] {
			_ = part.Close()
			return nil, "", bad("上传字段重复或不受支持")
		}
		seen[name] = true
		limit := int64(100)
		if name == "file" {
			limit = mediaMaxBytes
		}
		raw, readErr := io.ReadAll(io.LimitReader(part, limit+1))
		_ = part.Close()
		if readErr != nil {
			return nil, "", mediaReadError(readErr)
		}
		if int64(len(raw)) > limit {
			return nil, "", &APIError{413, "media_too_large", "图片或上传字段过大（图片最多8MiB）"}
		}
		if name == "file" {
			file = raw
		} else {
			clientID = string(raw)
		}
	}
	if len(file) == 0 || !seen["clientId"] || !requestPattern.MatchString(clientID) {
		return nil, "", bad("请提供图片及8–100位字母数字_-组成的clientId")
	}
	return file, clientID, nil
}
func mediaReadError(err error) error {
	var max *http.MaxBytesError
	if errors.As(err, &max) {
		return &APIError{413, "media_too_large", "图片上传请求最多8MiB加有限表单开销"}
	}
	return bad("图片上传内容不完整或格式无效")
}

type mediaBoundedWriter struct{ bytes.Buffer }

func (w *mediaBoundedWriter) Write(p []byte) (int, error) {
	if int64(w.Len()+len(p)) > mediaMaxBytes {
		return 0, &APIError{413, "media_too_large", "处理后图片超过8MiB，请降低图片尺寸"}
	}
	return w.Buffer.Write(p)
}
func normalizeMediaImage(raw []byte) ([]byte, string, int, int, error) {
	config, format, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil || format != "jpeg" && format != "png" {
		return nil, "", 0, 0, bad("仅支持完整有效的JPEG或PNG图片")
	}
	if config.Width < 1 || config.Height < 1 || config.Width > 8192 || config.Height > 8192 || int64(config.Width)*int64(config.Height) > 16_000_000 {
		return nil, "", 0, 0, bad("图片单边最多8192像素，总像素最多16MP")
	}
	decoded, actual, err := image.Decode(bytes.NewReader(raw))
	if err != nil || actual != format {
		return nil, "", 0, 0, bad("图片数据损坏或格式不正确")
	}
	if format == "jpeg" {
		decoded = orientMediaImage(decoded, raw)
	}
	output := &mediaBoundedWriter{}
	contentType := "image/png"
	if format == "jpeg" {
		contentType = "image/jpeg"
		err = jpeg.Encode(output, decoded, &jpeg.Options{Quality: 85})
	} else {
		err = png.Encode(output, decoded)
	}
	if err != nil {
		var api *APIError
		if errors.As(err, &api) {
			return nil, "", 0, 0, api
		}
		return nil, "", 0, 0, bad("图片无法安全处理")
	}
	return output.Bytes(), contentType, decoded.Bounds().Dx(), decoded.Bounds().Dy(), nil
}
