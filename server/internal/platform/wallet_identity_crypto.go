package platform

import (
	"bytes"
	"encoding/hex"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
	"golang.org/x/crypto/sha3"
)

var canonicalChainPattern = regexp.MustCompile(`^[1-9][0-9]{0,77}$`)
var walletGenerationPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

func (c Config) walletSettings() ([]string, []string) {
	origins, chains := c.WalletOrigins, c.WalletChains
	if len(origins) == 0 && c.Environment == "development" {
		for _, v := range []string{"http://localhost:5173", "http://127.0.0.1:5173"} {
			for _, allowed := range c.Origins {
				if allowed == v {
					origins = append(origins, v)
				}
			}
		}
	}
	if len(chains) == 0 && c.Environment == "development" {
		chains = []string{"1", "11155111"}
	}
	return origins, chains
}
func (c Config) validateWalletSettings() error {
	origins, chains := c.walletSettings()
	for _, origin := range origins {
		for _, b := range []byte(origin) {
			if b < 33 || b > 126 {
				return fmt.Errorf("WALLET_ORIGINS must be ASCII canonical origins")
			}
		}
		u, e := url.Parse(origin)
		if e != nil || u.Host == "" || u.Hostname() == "" || u.Opaque != "" || u.Path != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.User != nil || (u.Scheme != "http" && u.Scheme != "https") {
			return fmt.Errorf("invalid WALLET_ORIGINS origin")
		}
		if c.Environment == "production" && u.Scheme != "https" {
			return fmt.Errorf("production WALLET_ORIGINS require https")
		}
		found := false
		for _, allowed := range c.Origins {
			if allowed == origin {
				found = true
			}
		}
		if !found {
			return fmt.Errorf("WALLET_ORIGINS must be included in ALLOWED_ORIGINS")
		}
	}
	for _, chain := range chains {
		if !canonicalChainPattern.MatchString(chain) {
			return fmt.Errorf("invalid WALLET_CHAINS canonical decimal chain ID")
		}
	}
	return nil
}
func keccak(data []byte) []byte {
	h := sha3.NewLegacyKeccak256()
	_, _ = h.Write(data)
	return h.Sum(nil)
}
func walletChecksum(address []byte) string {
	lower := hex.EncodeToString(address)
	sum := keccak([]byte(lower))
	out := []byte(lower)
	for i, b := range out {
		nibble := sum[i/2]
		if i%2 == 0 {
			nibble >>= 4
		} else {
			nibble &= 15
		}
		if b >= 'a' && b <= 'f' && nibble >= 8 {
			out[i] = b - 32
		}
	}
	return "0x" + string(out)
}
func parseWalletAddress(value string) ([]byte, error) {
	if len(value) != 42 || !strings.HasPrefix(value, "0x") {
		return nil, bad("钱包地址格式无效")
	}
	raw, e := hex.DecodeString(value[2:])
	if e != nil || bytes.Equal(raw, make([]byte, 20)) {
		return nil, bad("钱包地址格式无效")
	}
	hexValue := value[2:]
	if hexValue != strings.ToLower(hexValue) && hexValue != strings.ToUpper(hexValue) && value != walletChecksum(raw) {
		return nil, bad("钱包地址校验和无效")
	}
	return raw, nil
}
func walletMessageHash(message string) []byte {
	return keccak([]byte("\x19Ethereum Signed Message:\n" + strconv.Itoa(len([]byte(message))) + message))
}
func verifyWalletSignature(message, signature string, address []byte) (bool, error) {
	if len(signature) != 132 || !strings.HasPrefix(signature, "0x") {
		return false, bad("钱包签名必须为65字节")
	}
	sig, e := hex.DecodeString(signature[2:])
	if e != nil {
		return false, bad("钱包签名格式无效")
	}
	recovery := sig[64]
	if recovery == 27 || recovery == 28 {
		recovery -= 27
	}
	if recovery > 1 {
		return false, bad("钱包签名恢复标记无效")
	}
	var r, s secp256k1.ModNScalar
	if r.SetByteSlice(sig[:32]) || s.SetByteSlice(sig[32:64]) || r.IsZero() || s.IsZero() || s.IsOverHalfOrder() {
		return false, bad("钱包签名标量无效")
	}
	compact := make([]byte, 65)
	compact[0] = 27 + recovery
	copy(compact[1:], sig[:64])
	pub, _, e := ecdsa.RecoverCompact(compact, walletMessageHash(message))
	if e != nil {
		return false, nil
	}
	recovered := keccak(pub.SerializeUncompressed()[1:])[12:]
	return bytes.Equal(recovered, address), nil
}
func canonicalWalletMessage(id, purpose, origin, uri, address, chain, nonce, user string, issued, expires time.Time) string {
	statement := "Sign in to your existing Gongming account. This request does not authorize transactions."
	if purpose == "bind" {
		statement = "Bind this wallet to Gongming account " + user + ". This request does not authorize transactions."
	}
	u, _ := url.Parse(origin)
	return origin[:len(origin)-len(u.Host)] + u.Host + " wants you to sign in with your Ethereum account:\n" + address + "\n\n" + statement + "\n\nURI: " + uri + "\nVersion: 1\nChain ID: " + chain + "\nNonce: " + nonce + "\nIssued At: " + issued.Format(time.RFC3339) + "\nExpiration Time: " + expires.Format(time.RFC3339) + "\nNot Before: " + issued.Format(time.RFC3339) + "\nRequest ID: " + id
}
