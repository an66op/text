package platform

import (
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var amountPattern = regexp.MustCompile(`^[1-9][0-9]{0,11}$`)

func walletOf(s *State, userID string) Wallet {
	stored := s.Wallets[userID]
	address := stored.Address
	if address == "" {
		address = "gm_test_" + tokenHash(userID)[:32]
	}
	transactions := append([]LedgerEntry{}, stored.Transactions...)
	newest(transactions, func(e LedgerEntry) time.Time { return e.CreatedAt })
	if len(transactions) > 100 {
		transactions = transactions[:100]
	}
	return Wallet{"Gongming Testnet", []Asset{{"GEM", "共鸣测试积分", strconv.FormatInt(stored.Balance, 10), 2}}, address, transactions}
}
func ensureWallet(s *State, userID string) StoredWallet {
	wallet := s.Wallets[userID]
	if wallet.Address == "" {
		wallet.Address = "gm_test_" + tokenHash(userID)[:32]
	}
	if wallet.Transactions == nil {
		wallet.Transactions = []LedgerEntry{}
	}
	return wallet
}
func (a *App) wallet(s *State, u *User, _ *http.Request) (any, error) { return walletOf(s, u.ID), nil }
func (a *App) faucet(s *State, u *User, r *http.Request) (any, error) {
	var input struct {
		RequestID string `json:"requestId"`
	}
	if err := decode(r, &input); err != nil {
		return nil, err
	}
	if !requestPattern.MatchString(input.RequestID) {
		return nil, bad("requestId 需为 8–100 位字母、数字、横线或下划线")
	}
	key := u.ID + ":" + input.RequestID
	if previous, exists := s.Idempotency[key]; exists {
		if previous.Fingerprint != "faucet" {
			return nil, conflict("requestId 已用于其他操作")
		}
		return previous.Result, nil
	}
	wallet := ensureWallet(s, u.ID)
	if !wallet.LastFaucet.IsZero() && a.now().Before(wallet.LastFaucet.Add(24*time.Hour)) {
		return nil, &APIError{429, "faucet_cooldown", "测试积分每 24 小时领取一次"}
	}
	wallet.Balance += 100000
	wallet.LastFaucet = a.now()
	wallet.Transactions = append(wallet.Transactions, LedgerEntry{newID("ledger_"), "faucet", "100000", "GEM", "测试水龙头", a.now(), input.RequestID})
	s.Wallets[u.ID] = wallet
	result := walletOf(s, u.ID)
	s.Idempotency[key] = Idempotency{"faucet", result}
	return result, nil
}
func (a *App) transfer(s *State, u *User, r *http.Request) (any, error) {
	var input struct {
		RecipientHandle string `json:"recipientHandle"`
		Amount          string `json:"amount"`
		RequestID       string `json:"requestId"`
	}
	if err := decode(r, &input); err != nil {
		return nil, err
	}
	input.RecipientHandle = strings.ToLower(strings.TrimSpace(input.RecipientHandle))
	if !handlePattern.MatchString(input.RecipientHandle) || !amountPattern.MatchString(input.Amount) || !requestPattern.MatchString(input.RequestID) {
		return nil, bad("请提供有效收款用户名、最小单位正整数金额和 requestId")
	}
	amount, err := strconv.ParseInt(input.Amount, 10, 64)
	if err != nil || amount <= 0 || amount > 100000000000 {
		return nil, bad("转账金额超出范围")
	}
	fingerprint := "transfer:" + input.RecipientHandle + ":" + input.Amount
	key := u.ID + ":" + input.RequestID
	if previous, exists := s.Idempotency[key]; exists {
		if previous.Fingerprint != fingerprint {
			return nil, conflict("requestId 已用于不同操作，请生成新的请求标识")
		}
		return previous.Result, nil
	}
	var recipient User
	for _, account := range s.Accounts {
		if account.User.Handle == input.RecipientHandle && account.User.Status == "active" {
			recipient = account.User
			break
		}
	}
	if recipient.ID == "" {
		return nil, missing("收款用户不存在或已停用")
	}
	if recipient.ID == u.ID {
		return nil, bad("不能向自己转账")
	}
	senderWallet := ensureWallet(s, u.ID)
	recipientWallet := ensureWallet(s, recipient.ID)
	if senderWallet.Balance < amount {
		return nil, &APIError{422, "insufficient_balance", "测试积分余额不足"}
	}
	if recipientWallet.Balance > 9223372036854775807-amount {
		return nil, conflict("收款余额已达上限")
	}
	senderWallet.Balance -= amount
	recipientWallet.Balance += amount
	id := newID("ledger_")
	now := a.now()
	senderWallet.Transactions = append(senderWallet.Transactions, LedgerEntry{id, "transfer_out", fmt.Sprintf("-%d", amount), "GEM", recipient.Handle, now, input.RequestID})
	recipientWallet.Transactions = append(recipientWallet.Transactions, LedgerEntry{id, "transfer_in", input.Amount, "GEM", u.Handle, now, input.RequestID})
	s.Wallets[u.ID] = senderWallet
	s.Wallets[recipient.ID] = recipientWallet
	result := walletOf(s, u.ID)
	s.Idempotency[key] = Idempotency{fingerprint, result}
	return result, nil
}
