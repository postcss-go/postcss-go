package utils

import "testing"

func TestPathClassification(t *testing.T) {
	tests := []struct {
		name string
		path string
		abs  bool
		uri  bool
	}{
		{name: "unix path", path: "/tmp/input.css", abs: true},
		{name: "windows path", path: `C:\\tmp\\input.css`, abs: true},
		{name: "file uri", path: "file:///tmp/input.css", uri: true},
		{name: "http uri", path: "https://example.test/input.css", uri: true},
		{name: "relative path", path: "styles/input.css"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := IsAbsoluteSourcePath(test.path); got != test.abs {
				t.Fatalf("absolute=%v, want %v", got, test.abs)
			}
			if got := IsURI(test.path); got != test.uri {
				t.Fatalf("uri=%v, want %v", got, test.uri)
			}
		})
	}
}
