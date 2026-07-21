// Package utils contains small helpers shared across the Go engine packages.
package utils

import (
	"net/url"
	"path/filepath"
	"strings"
)

func IsWindowsDrivePath(value string) bool {
	return len(value) >= 3 &&
		((value[0] >= 'a' && value[0] <= 'z') || (value[0] >= 'A' && value[0] <= 'Z')) &&
		value[1] == ':' && (value[2] == '/' || value[2] == '\\')
}

func IsAbsoluteSourcePath(value string) bool {
	return filepath.IsAbs(value) || strings.HasPrefix(value, "/") || IsWindowsDrivePath(value)
}

func IsURI(value string) bool {
	if IsAbsoluteSourcePath(value) {
		return false
	}
	u, err := url.Parse(value)
	return err == nil && u.Scheme != ""
}

func NormalizeSourcePath(value string) string {
	if IsWindowsDrivePath(value) {
		return filepath.FromSlash(strings.ReplaceAll(value, `\`, "/"))
	}
	return value
}
