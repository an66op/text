package platform

import (
	"encoding/json"
	"net/http"
	"sort"
	"strings"
)

// Only personal preference/draft domains may be synced. Shared and financial
// records have dedicated authoritative APIs; arbitrary storage keys are rejected.
var documentDomains = map[string]bool{"preferences": true, "drafts": true, "reading": true, "bookshelf": true, "bookmarks": true, "ai-history": true, "content-preferences": true, "circles-preferences": true, "matching-preferences": true, "profile-preferences": true}

func allowedDocumentKey(key string) bool { return documentDomains[key] }
func (a *App) documents(s *State, u *User, r *http.Request) (any, error) {
	items := []Document{}
	for key, document := range s.Documents[u.ID] {
		if matches(r, key) {
			items = append(items, document)
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Key < items[j].Key })
	return list(r, items)
}
func (a *App) putDocument(s *State, u *User, r *http.Request) (any, error) {
	key := r.PathValue("key")
	if !allowedDocumentKey(key) {
		return nil, bad("此业务域不允许同步")
	}
	var input struct {
		Value    json.RawMessage `json:"value"`
		Revision *int64          `json:"revision"`
	}
	if err := decode(r, &input); err != nil {
		return nil, err
	}
	if input.Revision == nil || *input.Revision < 0 || input.Value == nil || len(input.Value) > 128*1024 {
		return nil, bad("文档需包含有效 revision 和最多 128KB 的 value")
	}
	if len(s.Documents[u.ID]) >= 20 {
		if _, exists := s.Documents[u.ID][key]; !exists {
			return nil, bad("文档数量已达上限")
		}
	}
	if s.Documents[u.ID] == nil {
		s.Documents[u.ID] = map[string]Document{}
	}
	existing, exists := s.Documents[u.ID][key]
	if (!exists && *input.Revision != 0) || (exists && existing.Revision != *input.Revision) {
		return nil, &APIError{409, "revision_conflict", "云端资料已更新，请重新读取后再合并"}
	}
	if strings.Contains(key, "wallet") || strings.Contains(key, "order") {
		return nil, bad("资产或订单不能通过文档同步")
	}
	document := Document{key, input.Value, *input.Revision + 1, a.now()}
	s.Documents[u.ID][key] = document
	return document, nil
}
