package benchmark

import (
	"embed"
	"encoding/json"
	"fmt"
	"sort"
)

//go:embed fixtures/manifest.json
var manifestJSON []byte

//go:embed fixtures/css/*
var fixtureFS embed.FS

type realWorldManifestEntry struct {
	ID      string `json:"id"`
	File    string `json:"file"`
	Source  string `json:"source"`
	Version string `json:"version"`
	License string `json:"license"`
}

// RealWorldFixture is a vendored CSS file from a popular stylesheet source.
type RealWorldFixture struct {
	ID      string
	CSS     string
	Source  string
	Version string
	License string
	Bytes   int
}

// RealWorldFixtures returns vendored CSS fixtures sorted by ID.
func RealWorldFixtures() ([]RealWorldFixture, error) {
	var entries []realWorldManifestEntry
	if err := json.Unmarshal(manifestJSON, &entries); err != nil {
		return nil, fmt.Errorf("decode fixture manifest: %w", err)
	}

	fixtures := make([]RealWorldFixture, 0, len(entries))
	for _, entry := range entries {
		path := "fixtures/" + entry.File
		data, err := fixtureFS.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("read fixture %q: %w", entry.ID, err)
		}

		fixtures = append(fixtures, RealWorldFixture{
			ID:      entry.ID,
			CSS:     string(data),
			Source:  entry.Source,
			Version: entry.Version,
			License: entry.License,
			Bytes:   len(data),
		})
	}

	sort.Slice(fixtures, func(i, j int) bool {
		return fixtures[i].ID < fixtures[j].ID
	})

	return fixtures, nil
}

// RealWorldFixtureByID returns a single fixture by benchmark ID.
func RealWorldFixtureByID(id string) (RealWorldFixture, error) {
	fixtures, err := RealWorldFixtures()
	if err != nil {
		return RealWorldFixture{}, err
	}

	for _, fixture := range fixtures {
		if fixture.ID == id {
			return fixture, nil
		}
	}

	return RealWorldFixture{}, fmt.Errorf("unknown fixture id %q", id)
}
