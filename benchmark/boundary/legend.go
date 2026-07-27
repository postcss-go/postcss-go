package boundary

import (
	"fmt"
	"strings"
)

// printMetric writes a short banner immediately above a group of benchmark
// result lines so the go-test output can be scanned without memorizing names.
func printMetric(title string, lines ...string) {
	const width = 72
	fmt.Println()
	fmt.Println(strings.Repeat("-", width))
	fmt.Println(title)
	for _, line := range lines {
		fmt.Println("  " + strings.TrimSpace(line))
	}
	fmt.Println(strings.Repeat("-", width))
}
