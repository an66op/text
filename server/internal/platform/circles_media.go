package platform

import (
	"net/http"
	"regexp"
	"sort"
)

var circleMediaUploadPathPattern = regexp.MustCompile(`^/api/v1/circles/circle_[a-f0-9]{32}/media/images$`)

type AdminMediaCirclePost struct {
	CircleID  string `json:"circleId"`
	ChannelID string `json:"channelId"`
	ID        string `json:"id"`
	Body      string `json:"body"`
	Status    string `json:"status"`
}

func effectiveMediaScope(v StoredMediaAsset) string {
	if v.Scope == "" {
		return "world"
	}
	return v.Scope
}
func (a *App) uploadCircleMediaImage(w http.ResponseWriter, r *http.Request) {
	a.uploadMediaImageScoped(w, r, r.PathValue("id"))
}
func canonicalCircleImages(images []string) ([]string, error) {
	if len(images) > 9 {
		return nil, bad("圈帖最多9张图片")
	}
	result := []string{}
	seen := map[string]bool{}
	for _, image := range images {
		id, ok := mediaIDFromURL(image)
		if !ok {
			return nil, bad("圈帖图片只能使用本圈托管图片的规范相对地址")
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		result = append(result, image)
	}
	return result, nil
}
func validateCirclePostMedia(s *State, circle, owner string, images []string) ([]string, error) {
	result, err := canonicalCircleImages(images)
	if err != nil {
		return nil, err
	}
	for _, value := range result {
		id, _ := mediaIDFromURL(value)
		v, exists := s.Media[id]
		if !exists || v.OwnerID != owner || v.DeletedAt != nil || v.Status != "ready" || effectiveMediaScope(v) != "circle" || v.CircleID != circle {
			return nil, bad("圈帖图片必须为本人在本圈上传的可用图片")
		}
	}
	return result, nil
}
func circleMediaReferences(s *State, id string) []StoredCirclePost {
	items := []StoredCirclePost{}
	for _, p := range s.CirclePosts {
		if p.DeletedAt != nil {
			continue
		}
		for _, image := range p.Images {
			if image == mediaURLPrefix+id {
				items = append(items, p)
				break
			}
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].CreatedAt.Equal(items[j].CreatedAt) {
			return items[i].ID < items[j].ID
		}
		return items[i].CreatedAt.After(items[j].CreatedAt)
	})
	return items
}
func canReadCircleMedia(s *State, asset StoredMediaAsset, u *User) bool {
	if u == nil || effectiveMediaScope(asset) != "circle" {
		return false
	}
	for _, p := range circleMediaReferences(s, asset.ID) {
		if p.CircleID != asset.CircleID || p.Status != "published" {
			continue
		}
		if _, _, _, err := circleChannelAccess(s, u, p.CircleID, p.ChannelID, false, false); err == nil {
			return true
		}
	}
	return false
}
