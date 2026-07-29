package benchmark

import (
	"strings"
	"testing"
)

func TestGenerateCSS(t *testing.T) {
	css := GenerateCSS(3)
	if css == "" {
		t.Fatal("expected generated CSS")
	}
	for _, needle := range []string{".class-0", ".class-1", ".class-2", "display: flex"} {
		if !strings.Contains(css, needle) {
			t.Fatalf("expected %q in generated CSS:\n%s", needle, css)
		}
	}
	if GenerateCSS(0) != "" {
		t.Fatal("zero rules should produce empty CSS")
	}
}

func TestRealWorldFixtureByID(t *testing.T) {
	fixtures, err := RealWorldFixtures()
	if err != nil {
		t.Fatalf("RealWorldFixtures: %v", err)
	}
	if len(fixtures) == 0 {
		t.Fatal("expected at least one real-world fixture")
	}

	got, err := RealWorldFixtureByID(fixtures[0].ID)
	if err != nil {
		t.Fatalf("RealWorldFixtureByID(%q): %v", fixtures[0].ID, err)
	}
	if got.ID != fixtures[0].ID || got.CSS == "" || got.Bytes != len(got.CSS) {
		t.Fatalf("unexpected fixture: %#v", got)
	}

	if _, err := RealWorldFixtureByID("definitely-missing-fixture"); err == nil {
		t.Fatal("expected unknown fixture id error")
	}
}
