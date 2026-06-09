package benchmark

import (
	"fmt"
	"strings"
)

// Sizes used by both Go and Node benchmarks for apples-to-apples comparison.
const (
	SmallRules  = 10
	MediumRules = 1_000
	LargeRules  = 10_000
)

// GenerateCSS builds deterministic CSS with the given number of rules.
func GenerateCSS(rules int) string {
	var b strings.Builder
	b.Grow(rules * 64)
	for i := 0; i < rules; i++ {
		fmt.Fprintf(
			&b,
			".class-%d { color: #%06x; margin: %dpx; padding: %dpx; display: flex; }\n",
			i,
			i&0xffffff,
			i%10,
			i%20,
		)
	}
	return b.String()
}
