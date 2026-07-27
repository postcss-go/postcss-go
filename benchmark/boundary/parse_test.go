package boundary

import (
	"fmt"
	"strings"
	"testing"

	"postcss-go/internal/parser"
	"postcss-go/internal/sourcemap"
)

// BenchmarkParseThroughput compares MB/s across fixtures. Minified stylesheets
// come out roughly two orders of magnitude slower per byte than formatted ones,
// which is what BenchmarkParseScaling then pins down.
func BenchmarkParseThroughput(b *testing.B) {
	printMetric(
		"ParseThroughput — parse speed per byte (read MB/s)",
		"Higher MB/s is better. Fixtures of similar size should land in a similar range.",
		"A minified file far slower than a formatted one of similar size means",
		"newline-sensitive work (see ParseScaling), not raw volume.",
	)

	for _, f := range fixtures(b) {
		b.Run(f.name, func(b *testing.B) {
			b.SetBytes(int64(len(f.css)))
			for b.Loop() {
				if _, err := parser.Parse(f.css, sourcemap.Options{From: "x.css", TrackSource: true}); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

// BenchmarkParseScaling isolates the effect of newlines on parse cost by
// feeding identical rules with and without line breaks.
//
// Reading the result: ns/op should roughly double as the rule count doubles.
// Where it quadruples instead, parsing is quadratic in input size. Column
// positions are resolved by scanning from the start of the line, so a file with
// no newlines rescans the whole prefix for every position lookup.
func BenchmarkParseScaling(b *testing.B) {
	groups := []struct {
		label, value, title string
		detail              []string
	}{
		{
			label: "newline-separated",
			value: "\n",
			title: "before — newline-separated (formatted shape)",
			detail: []string{
				"Identical rules, one per line. Compare ns/op as the rule count doubles:",
				"roughly 2x means linear cost.",
			},
		},
		{
			label: "single-line",
			value: "",
			title: "after — single-line (minified shape)",
			detail: []string{
				"Same rules, no newlines. Compare ns/op as the rule count doubles:",
				"roughly 4x means quadratic cost (rescans from the start of the only line).",
			},
		},
	}

	for _, group := range groups {
		b.Run(group.label, func(b *testing.B) {
			printMetric(group.title, group.detail...)
			for _, rules := range []int{500, 1000, 2000, 4000} {
				css := buildRules(rules, group.value)
				b.Run(fmt.Sprintf("%d", rules), func(b *testing.B) {
					b.SetBytes(int64(len(css)))
					for b.Loop() {
						if _, err := parser.Parse(css, sourcemap.Options{From: "x.css", TrackSource: true}); err != nil {
							b.Fatal(err)
						}
					}
				})
			}
		})
	}
}

func buildRules(rules int, separator string) string {
	parts := make([]string, 0, rules)
	for i := 0; i < rules; i++ {
		parts = append(parts, fmt.Sprintf(".c-%d{color:red;margin:%dpx}", i, i%10))
	}
	return strings.Join(parts, separator)
}
