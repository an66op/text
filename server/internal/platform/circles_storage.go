package platform

import "time"

// Circle storage is separate from direct/group/channel messaging and the
// browser-only prototype. Circle roles never derive from platform user roles.
type StoredCircle struct {
	ID          string    `json:"id"`
	CreatorID   string    `json:"creatorId"`
	ClientID    string    `json:"clientId"`
	Fingerprint string    `json:"fingerprint"`
	OwnerID     string    `json:"ownerId"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Icon        string    `json:"icon"`
	Cover       string    `json:"cover"`
	Category    string    `json:"category"`
	Visibility  string    `json:"visibility"`
	JoinPolicy  string    `json:"joinPolicy"`
	Status      string    `json:"status"`
	Note        string    `json:"note"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}
type StoredCircleMember struct {
	CircleID  string    `json:"circleId"`
	UserID    string    `json:"userId"`
	Role      string    `json:"role"`
	Status    string    `json:"status"`
	Note      string    `json:"note"`
	JoinedAt  time.Time `json:"joinedAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}
type StoredCircleJoinRequest struct {
	ID         string    `json:"id"`
	CircleID   string    `json:"circleId"`
	UserID     string    `json:"userId"`
	Note       string    `json:"note"`
	Status     string    `json:"status"`
	ReviewerID string    `json:"reviewerId"`
	ReviewNote string    `json:"reviewNote"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}
type StoredCircleChannel struct {
	ID          string    `json:"id"`
	CircleID    string    `json:"circleId"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Kind        string    `json:"kind"`
	Access      string    `json:"access"`
	Archived    bool      `json:"archived"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}
type StoredCirclePost struct {
	ID          string          `json:"id"`
	CircleID    string          `json:"circleId"`
	ChannelID   string          `json:"channelId"`
	AuthorID    string          `json:"authorId"`
	ClientID    string          `json:"clientId"`
	Fingerprint string          `json:"fingerprint"`
	Title       string          `json:"title"`
	Body        string          `json:"body"`
	Images      []string        `json:"images"`
	Status      string          `json:"status"`
	Pinned      bool            `json:"pinned"`
	Featured    bool            `json:"featured"`
	Note        string          `json:"note"`
	CreatedAt   time.Time       `json:"createdAt"`
	UpdatedAt   time.Time       `json:"updatedAt"`
	Likes       map[string]bool `json:"likes"`
	DeletedAt   *time.Time      `json:"deletedAt,omitempty"`
}
type StoredCircleComment struct {
	ID        string    `json:"id"`
	CircleID  string    `json:"circleId"`
	PostID    string    `json:"postId"`
	AuthorID  string    `json:"authorId"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"createdAt"`
}
type StoredCircleInvite struct {
	ID        string     `json:"id"`
	CircleID  string     `json:"circleId"`
	CreatorID string     `json:"creatorId"`
	TokenHash string     `json:"tokenHash"`
	MaxUses   int        `json:"maxUses"`
	Uses      int        `json:"uses"`
	ExpiresAt time.Time  `json:"expiresAt"`
	RevokedAt *time.Time `json:"revokedAt,omitempty"`
	CreatedAt time.Time  `json:"createdAt"`
}
type StoredCircleInviteRedemption struct {
	InviteID  string    `json:"inviteId"`
	UserID    string    `json:"userId"`
	CreatedAt time.Time `json:"createdAt"`
}

func circleMemberKey(circle, user string) string     { return circle + ":" + user }
func circleRedemptionKey(invite, user string) string { return invite + ":" + user }
func initializeCircles(s *State) {
	if s.Circles == nil {
		s.Circles = map[string]StoredCircle{}
	}
	if s.CircleMembers == nil {
		s.CircleMembers = map[string]StoredCircleMember{}
	}
	if s.CircleJoinRequests == nil {
		s.CircleJoinRequests = map[string]StoredCircleJoinRequest{}
	}
	if s.CircleChannels == nil {
		s.CircleChannels = map[string]StoredCircleChannel{}
	}
	if s.CirclePosts == nil {
		s.CirclePosts = map[string]StoredCirclePost{}
	}
	if s.CircleComments == nil {
		s.CircleComments = map[string]StoredCircleComment{}
	}
	if s.CircleInvites == nil {
		s.CircleInvites = map[string]StoredCircleInvite{}
	}
	if s.CircleInviteRedemptions == nil {
		s.CircleInviteRedemptions = map[string]StoredCircleInviteRedemption{}
	}
}
