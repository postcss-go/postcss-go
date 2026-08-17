// Package main builds the private postcss-go Node-API native library. Most
// targets use a c-archive; companion-library targets use c-shared:
//
//	go build -tags=nativeaddon -buildmode=c-archive -o libpostcssgo.a ./internal/nativeaddon/cabi
//	go build -tags=nativeaddon -buildmode=c-shared -o libpostcssgo.so ./internal/nativeaddon/cabi
//	go build -tags=nativeaddon -buildmode=c-shared -o libpostcssgo.dll ./internal/nativeaddon/cabi
//
// The C ABI is in cgo.go (nativeaddon tag). The C exports speak binary codec
// on the AST path so JavaScript never pays for JSON encode/decode on
// parse/stringify.
package main

func main() {}
