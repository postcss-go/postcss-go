package stringifier

import "testing"

func TestWindowsDrivePathsAreNotURIs(t *testing.T) {
	if isURI(`C:\repo\dist\output.css.map`) {
		t.Fatal("Windows drive-letter paths must not be treated as URIs")
	}
}
