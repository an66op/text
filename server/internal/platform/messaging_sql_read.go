package platform

import (
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5"
)

// These projections select public identity fields explicitly. Neither full
// accounts nor unrelated product tables enter the messaging read path.
const messagingSQLMessageFields = `m.id,m.conversation_id,m.body,m.created_at,m.seq,COALESCE(m.client_id,''),m.retracted_at,u.id,u.handle,u.name,u.avatar,u.bio`

// Go's existing search uses Unicode simple lowercase, independent of database
// locale. SQL lower() differs under C (and even ICU has contextual/expanding
// mappings). translate() applies exactly the same one-rune mapping as Go,
// including Kelvin sign, dotted I, Greek, and non-BMP letters. Construct the
// complete mapping once from the same Go Unicode tables as strings.ToLower.
var messagingSQLLowerFrom, messagingSQLLowerTo = func() (string, string) {
	var from, to strings.Builder
	for _, block := range unicode.CaseRanges {
		for value := rune(block.Lo); value <= rune(block.Hi); value++ {
			if lower := unicode.ToLower(value); lower != value {
				from.WriteRune(value)
				to.WriteRune(lower)
			}
		}
	}
	return from.String(), to.String()
}()

type messagingSQLScanner interface{ Scan(...any) error }

func scanMessagingSQLMessage(row messagingSQLScanner) (Message, error) {
	v := Message{}
	err := row.Scan(&v.ID, &v.ConversationID, &v.Body, &v.CreatedAt, &v.Seq, &v.ClientID, &v.RetractedAt, &v.Sender.ID, &v.Sender.Handle, &v.Sender.Name, &v.Sender.Avatar, &v.Sender.Bio)
	return v, err
}

const messagingSQLConversationProjection = `SELECT c.id,c.title,c.kind,c.owner_id,c.created_at,c.mutation_version,
 ARRAY(SELECT member.user_id FROM gongming_conversation_members member WHERE member.conversation_id=c.id ORDER BY member.position),
 COALESCE(r.seq,0),COALESCE(r.message_id,''),
 (SELECT count(*) FROM gongming_messages unread WHERE unread.conversation_id=c.id AND unread.sender_id<>$1 AND unread.retracted_at IS NULL AND unread.seq>COALESCE(r.seq,0)),
 last.id,COALESCE(last.body,''),last.created_at,COALESCE(last.seq,0),COALESCE(last.client_id,''),last.retracted_at,
 COALESCE(sender.id,''),COALESCE(sender.handle,''),COALESCE(sender.name,''),COALESCE(sender.avatar,''),COALESCE(sender.bio,'')
 FROM gongming_conversations c
 LEFT JOIN gongming_conversation_reads r ON r.conversation_id=c.id AND r.user_id=$1
 LEFT JOIN LATERAL (SELECT * FROM gongming_messages m WHERE m.conversation_id=c.id ORDER BY m.seq DESC,m.id DESC LIMIT 1) last ON true
 LEFT JOIN gongming_users sender ON sender.id=last.sender_id`

func scanMessagingSQLConversation(row messagingSQLScanner) (Conversation, error) {
	v := Conversation{}
	m := Message{}
	var lastID *string
	var lastCreated *time.Time
	err := row.Scan(&v.ID, &v.Title, &v.Kind, &v.OwnerID, &v.CreatedAt, &v.MutationVersion, &v.Members, &v.ReadSeq, &v.LastReadMessageID, &v.UnreadCount,
		&lastID, &m.Body, &lastCreated, &m.Seq, &m.ClientID, &m.RetractedAt, &m.Sender.ID, &m.Sender.Handle, &m.Sender.Name, &m.Sender.Avatar, &m.Sender.Bio)
	if err == nil && lastID != nil {
		m.ID, m.ConversationID, m.CreatedAt = *lastID, v.ID, *lastCreated
		v.LastMessage = &m
	}
	return v, err
}

func messagingSQLPage(r *http.Request) (limit, offset int, err error) {
	limit = 30
	if value := r.URL.Query().Get("limit"); value != "" {
		limit, err = strconv.Atoi(value)
		if err != nil || limit < 1 || limit > 100 {
			return 0, 0, bad("limit 必须为 1 到 100")
		}
	}
	if value := r.URL.Query().Get("offset"); value != "" {
		offset, err = strconv.Atoi(value)
		if err != nil || offset < 0 || offset > 100000 {
			return 0, 0, bad("offset 不正确")
		}
	}
	return limit, offset, nil
}

func messagingSQLConversations(r *http.Request, tx pgx.Tx, u PublicUser) (any, error) {
	limit, offset, err := messagingSQLPage(r)
	if err != nil {
		return nil, err
	}
	q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	total, unreadTotal := 0, 0
	// unreadTotal deliberately precedes both title filtering and pagination.
	// PostgreSQL text cannot contain NUL. Such a search cannot match persisted
	// titles, but its unfiltered unreadTotal must still be returned.
	noMatch := strings.ContainsRune(q, 0)
	if noMatch {
		q = ""
	}
	err = tx.QueryRow(r.Context(), `SELECT count(*) FILTER(WHERE NOT $5::boolean AND ($2='' OR strpos(translate(c.title,$3,$4),$2)>0)),COALESCE(sum((SELECT count(*) FROM gongming_messages m WHERE m.conversation_id=c.id AND m.sender_id<>$1 AND m.retracted_at IS NULL AND m.seq>COALESCE(r.seq,0))),0) FROM gongming_conversation_members joined JOIN gongming_conversations c ON c.id=joined.conversation_id LEFT JOIN gongming_conversation_reads r ON r.conversation_id=c.id AND r.user_id=$1 WHERE joined.user_id=$1`, u.ID, q, messagingSQLLowerFrom, messagingSQLLowerTo, noMatch).Scan(&total, &unreadTotal)
	if err != nil {
		return nil, err
	}
	if noMatch {
		return map[string]any{"items": []Conversation{}, "total": total, "unreadTotal": unreadTotal}, nil
	}
	rows, err := tx.Query(r.Context(), messagingSQLConversationProjection+` WHERE EXISTS(SELECT 1 FROM gongming_conversation_members joined WHERE joined.conversation_id=c.id AND joined.user_id=$1) AND ($2='' OR strpos(translate(c.title,$5,$6),$2)>0) ORDER BY COALESCE(last.created_at,c.created_at) DESC,c.id LIMIT $3 OFFSET $4`, u.ID, q, limit, offset, messagingSQLLowerFrom, messagingSQLLowerTo)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Conversation{}
	for rows.Next() {
		v, err := scanMessagingSQLConversation(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, v)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	lastMessages := []Message{}
	for _, conversation := range items {
		if conversation.LastMessage != nil {
			lastMessages = append(lastMessages, *conversation.LastMessage)
		}
	}
	projected, e := projectMessagesSQL(r.Context(), tx, lastMessages, u.ID, 0)
	if e != nil {
		return nil, e
	}
	byID := map[string]Message{}
	for _, m := range projected {
		byID[m.ID] = m
	}
	for i := range items {
		if items[i].LastMessage != nil {
			m := byID[items[i].LastMessage.ID]
			m.Revision = items[i].MutationVersion + 1
			if m.ReplyTo != nil {
				m.ReplyTo.Revision = m.Revision
			}
			items[i].LastMessage = &m
		}
	}
	return map[string]any{"items": items, "total": total, "unreadTotal": unreadTotal}, nil
}

func messagingSQLDetail(r *http.Request, tx pgx.Tx, u PublicUser) (any, error) {
	if _, err := messagingSQLConversation(r.Context(), tx, r.PathValue("id"), u.ID, ""); err != nil {
		return nil, err
	}
	c, err := scanMessagingSQLConversation(tx.QueryRow(r.Context(), messagingSQLConversationProjection+` WHERE c.id=$2`, u.ID, r.PathValue("id")))
	if err != nil {
		return nil, err
	}
	rows, err := tx.Query(r.Context(), `SELECT u.id,u.handle,u.name,u.avatar,u.bio FROM gongming_conversation_members m JOIN gongming_users u ON u.id=m.user_id WHERE m.conversation_id=$1 ORDER BY m.position`, c.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	profiles := []PublicUser{}
	for rows.Next() {
		v := PublicUser{}
		if err = rows.Scan(&v.ID, &v.Handle, &v.Name, &v.Avatar, &v.Bio); err != nil {
			return nil, err
		}
		profiles = append(profiles, v)
	}
	if c.LastMessage != nil {
		if err = rows.Err(); err != nil {
			return nil, err
		}
		rows.Close()
		projected, e := projectMessagesSQL(r.Context(), tx, []Message{*c.LastMessage}, u.ID, c.MutationVersion)
		if e != nil {
			return nil, e
		}
		c.LastMessage = &projected[0]
	}
	return struct {
		Conversation   Conversation `json:"conversation"`
		MemberProfiles []PublicUser `json:"memberProfiles"`
	}{c, profiles}, rows.Err()
}

func messagingSQLHistory(r *http.Request, tx pgx.Tx, u PublicUser) (any, error) {
	c, err := messagingSQLConversation(r.Context(), tx, r.PathValue("id"), u.ID, "")
	if err != nil {
		return nil, err
	}
	version, err := messageMutationVersion(r.Context(), tx, c.ID)
	if err != nil {
		return nil, err
	}
	query := r.URL.Query()
	before, after := int64(0), int64(0)
	for _, cursor := range []struct {
		key string
		seq *int64
	}{{"beforeSeq", &before}, {"afterSeq", &after}} {
		if value := query.Get(cursor.key); value != "" {
			*cursor.seq, err = strconv.ParseInt(value, 10, 64)
			if err != nil || *cursor.seq < 0 || *cursor.seq > maxMessageSequence || cursor.key == "beforeSeq" && *cursor.seq == 0 {
				return nil, bad(cursor.key + " 必须为有效消息游标")
			}
		}
	}
	if id := query.Get("beforeId"); id != "" {
		if before != 0 {
			return nil, bad("beforeId 与 beforeSeq 不能同时使用")
		}
		err = tx.QueryRow(r.Context(), `SELECT seq FROM gongming_messages WHERE id=$1 AND conversation_id=$2`, id, c.ID).Scan(&before)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, missing("历史消息游标不存在")
		}
		if err != nil {
			return nil, err
		}
	}
	forward := query.Get("afterSeq") != ""
	if before > 0 && forward {
		return nil, bad("不能同时向前和向后翻页")
	}
	if (before > 0 || forward) && query.Get("offset") != "" && query.Get("offset") != "0" {
		return nil, bad("游标分页不能与 offset 混用")
	}
	limit, offset, err := messagingSQLPage(r)
	if err != nil {
		return nil, err
	}
	q := strings.ToLower(strings.TrimSpace(query.Get("q")))
	total := 0
	if strings.ContainsRune(q, 0) {
		return map[string]any{"mutationVersion": version, "items": []Message{}, "total": 0, "hasMore": false, "nextBeforeId": nil, "nextBeforeSeq": nil}, nil
	}
	if err = tx.QueryRow(r.Context(), `SELECT count(*) FROM gongming_messages WHERE conversation_id=$1 AND ($2='' OR strpos(translate(body,$3,$4),$2)>0)`, c.ID, q, messagingSQLLowerFrom, messagingSQLLowerTo).Scan(&total); err != nil {
		return nil, err
	}
	order := `DESC`
	if forward {
		order = `ASC`
	}
	rows, err := tx.Query(r.Context(), `SELECT `+messagingSQLMessageFields+` FROM gongming_messages m JOIN gongming_users u ON u.id=m.sender_id WHERE m.conversation_id=$1 AND ($2='' OR strpos(translate(m.body,$8,$9),$2)>0) AND ($3::bigint=0 OR m.seq<$3) AND (NOT $4::boolean OR m.seq>$5) ORDER BY m.seq `+order+`,m.id `+order+` LIMIT $6 OFFSET $7`, c.ID, q, before, forward, after, limit+1, offset, messagingSQLLowerFrom, messagingSQLLowerTo)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Message{}
	for rows.Next() {
		m, err := scanMessagingSQLMessage(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, m)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	items, err = projectMessagesSQL(r.Context(), tx, items, u.ID, version)
	if err != nil {
		return nil, err
	}
	hasMore := len(items) > limit
	if hasMore {
		items = items[:limit]
	}
	var nextID, nextSeq any
	if !forward {
		slices.Reverse(items)
		if hasMore && len(items) > 0 {
			nextID, nextSeq = items[0].ID, items[0].Seq
		}
	}
	return map[string]any{"mutationVersion": version, "items": items, "total": total, "hasMore": hasMore, "nextBeforeId": nextID, "nextBeforeSeq": nextSeq}, nil
}
