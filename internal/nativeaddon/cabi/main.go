// Package main builds the private postcss-go Node-API native library. Most
// targets use a c-archive; companion-library targets use c-shared:
//
//	go build -tags=nativeaddon -buildmode=c-archive -o libpostcssgo.a ./internal/nativeaddon/cabi
//	go build -tags=nativeaddon -buildmode=c-shared -o libpostcssgo.so ./internal/nativeaddon/cabi
//	go build -tags=nativeaddon -buildmode=c-shared -o libpostcssgo.dll ./internal/nativeaddon/cabi
//
// The C ABI is in cgo.go (nativeaddon tag). Parse/stringify of live trees use
// handle sessions; string-in/string-out process and noWork stay on this C path.
package main

func main() {}
