package platform

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"unicode/utf8"
)

type MessageImage struct {
	ID          string  `json:"id"`
	URL         *string `json:"url"`
	ContentType string  `json:"contentType"`
	Width       int     `json:"width"`
	Height      int     `json:"height"`
	Bytes       int64   `json:"bytes"`
	Available   bool    `json:"available"`
}
type MessageReply struct {
	ID         string      `json:"id"`
	Revision   int64       `json:"revision"`
	Available  bool        `json:"available"`
	Sender     *PublicUser `json:"sender"`
	Body       *string     `json:"body"`
	ImageCount int         `json:"imageCount"`
}
type messageInput struct {
	Body      string   `json:"body"`
	ClientID  string   `json:"clientId"`
	ImageIDs  []string `json:"imageIds"`
	ReplyToID string   `json:"replyToId"`
}

func decodeMessageInput(r *http.Request) (messageInput, string, error) {
	var input messageInput
	if err := decode(r, &input); err != nil {
		return input, "", err
	}
	input.Body = strings.TrimSpace(input.Body)
	if utf8.RuneCountInString(input.Body) > 5000 || strings.ContainsRune(input.Body, 0) || len(input.ImageIDs) > 9 || input.Body == "" && len(input.ImageIDs) == 0 {
		return input, "", bad("消息需要正文或最多9张图片，正文最多5000字")
	}
	if input.ClientID != "" && !requestPattern.MatchString(input.ClientID) {
		return input, "", bad("clientId格式无效")
	}
	if (len(input.ImageIDs) > 0 || input.ReplyToID != "") && input.ClientID == "" {
		return input, "", bad("图片或引用消息必须提供clientId")
	}
	if len(input.ReplyToID) > 128 || strings.ContainsRune(input.ReplyToID, 0) {
		return input, "", bad("引用消息编号无效")
	}
	seen := map[string]bool{}
	for _, id := range input.ImageIDs {
		if !mediaIDPattern.MatchString(id) || seen[id] {
			return input, "", bad("图片编号无效或重复")
		}
		seen[id] = true
	}
	if input.ImageIDs == nil {
		input.ImageIDs = []string{}
	}
	return input, messageFingerprint(input.Body, input.ImageIDs, input.ReplyToID), nil
}
func messageFingerprint(body string, images []string, reply string) string {
	if images == nil {
		images = []string{}
	}
	raw, _ := json.Marshal(struct {
		Body   string   `json:"body"`
		Images []string `json:"imageIds"`
		Reply  string   `json:"replyToId"`
	}{body, images, reply})
	hash := sha256.Sum256(raw)
	return hex.EncodeToString(hash[:])
}
func shortMessageText(body string) string {
	runes := []rune(body)
	if len(runes) > 200 {
		return string(runes[:200])
	}
	return body
}
