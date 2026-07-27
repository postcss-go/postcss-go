// Package codec is a compact binary encoding of the PostCSS-facing AST.
//
// It exists to replace JSON on the JavaScript↔Go boundary: no reflection, no
// escaped strings, and payloads that stay near the size of the source CSS.
//
// EncodeAST / DecodeAST walk the live Go AST directly. EncodeDTO / DecodeDTO
// cover the same wire format for callers that already hold a bridge DTO.
// Source-column adjustments match jsbridge.ToDTO so the two encode paths stay
// semantically equivalent.
package codec

const (
	magic0  = 'P'
	magic1  = 'C'
	magic2  = 'G'
	magic3  = 'W'
	version = 1
)

const (
	tagRoot byte = iota + 1
	tagDocument
	tagRule
	tagAtRule
	tagDecl
	tagComment
)

const (
	rawNull byte = iota
	rawString
	rawBool
	rawRawValue
	rawInt
	rawFloat
	rawMap
	rawList
)
