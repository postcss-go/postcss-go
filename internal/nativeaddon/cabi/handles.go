//go:build nativeaddon

package main

/*
#include <stdlib.h>
#ifndef PCGO_HANDLE_ERROR_H
#define PCGO_HANDLE_ERROR_H
typedef struct { unsigned int code; char* message; size_t length; } pcgoHandleError;
#endif
*/
import "C"

import (
	"encoding/json"
	"github.com/postcss-go/postcss-go/internal/sourcemap"
	"github.com/postcss-go/postcss-go/internal/stringifier"
	"io"
	"math"
	"strings"
	"unsafe"

	"github.com/postcss-go/postcss-go/internal/asthandle"
)

var handleSessions asthandle.Registry

//export pcgoHandleFreeError
func pcgoHandleFreeError(out *C.pcgoHandleError) {
	if out != nil {
		C.free(unsafe.Pointer(out.message))
		out.message = nil
		out.length = 0
	}
}

//export pcgoHandleSessionCount
func pcgoHandleSessionCount() C.uint { return C.uint(handleSessions.Len()) }

// Error memory is owned by this invocation and freed by the C caller.
func handleFail(out *C.pcgoHandleError, err error) C.int {
	if out != nil {
		out.code = C.uint(asthandle.ErrorStatus(err))
		out.message = C.CString(err.Error())
		out.length = C.size_t(len(err.Error()))
	}
	return -1
}

func copyOut(value string, buf *C.char, capacity C.int) int {
	if len(value) > math.MaxInt32 {
		return -1
	}
	if len(value) > int(capacity) {
		return len(value)
	}
	out := unsafe.Slice((*byte)(unsafe.Pointer(buf)), int(capacity))
	return copy(out, value)
}

//export pcgoHandleParse
func pcgoHandleParse(buf *C.char, length C.int, rootOut *C.uint, optionsJSON *C.char, optionsLength C.int, errorOut *C.pcgoHandleError) C.uint {
	css := C.GoStringN(buf, length)
	var options *struct {
		From         string `json:"from"`
		Document     string `json:"document"`
		TrackSource  bool   `json:"trackSource"`
		SourceMap    string `json:"sourceMap"`
		SourceMapURL string `json:"sourceMapUrl"`
	}
	if optionsJSON != nil {
		decoder := json.NewDecoder(strings.NewReader(C.GoStringN(optionsJSON, optionsLength)))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&options); err != nil || options == nil {
			handleFail(errorOut, asthandle.ErrInvalidArgument)
			return 0
		}
		if err := decoder.Decode(new(any)); err != io.EOF {
			handleFail(errorOut, asthandle.ErrInvalidArgument)
			return 0
		}
	}
	var parseOptions sourcemap.Options
	if options != nil {
		parseOptions = sourcemap.Options{
			From:         options.From,
			Document:     options.Document,
			TrackSource:  options.TrackSource,
			SourceMapURL: options.SourceMapURL,
		}
		if options.SourceMap != "" {
			parseOptions.SourceMap = []byte(options.SourceMap)
		}
	}
	id, root, err := handleSessions.ParseWithOptions(css, parseOptions)
	if err != nil {
		handleFail(errorOut, err)
		return 0
	}
	*rootOut = C.uint(root)
	return C.uint(id)
}

//export pcgoHandleClose
func pcgoHandleClose(id C.uint) {
	handleSessions.Close(uint32(id))
}

//export pcgoHandleType
func pcgoHandleType(sessionID C.uint, handle C.uint, errorOut *C.pcgoHandleError) C.int {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		return handleFail(errorOut, asthandle.ErrClosed)
	}
	kind, err := session.Type(asthandle.Handle(handle))
	if err != nil {
		return handleFail(errorOut, err)
	}
	return C.int(kind)
}

//export pcgoHandleGetField
func pcgoHandleGetField(sessionID C.uint, handle C.uint, field C.int, buf *C.char, capacity C.int, errorOut *C.pcgoHandleError) C.int {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		return handleFail(errorOut, asthandle.ErrClosed)
	}
	value, err := session.GetField(asthandle.Handle(handle), asthandle.Field(field))
	if err != nil {
		return handleFail(errorOut, err)
	}
	return C.int(copyOut(value, buf, capacity))
}

//export pcgoHandleSetField
func pcgoHandleSetField(sessionID C.uint, handle C.uint, field C.int, buf *C.char, length C.int, errorOut *C.pcgoHandleError) C.int {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		return handleFail(errorOut, asthandle.ErrClosed)
	}
	if err := session.SetField(asthandle.Handle(handle), asthandle.Field(field), C.GoStringN(buf, length)); err != nil {
		return handleFail(errorOut, err)
	}
	return 0
}

//export pcgoHandleWalkDecls
func pcgoHandleWalkDecls(sessionID C.uint, root C.uint, out *C.uint, capacity C.int, errorOut *C.pcgoHandleError) C.int {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		return handleFail(errorOut, asthandle.ErrClosed)
	}
	handles, err := session.Collect(asthandle.Handle(root), true)
	if err != nil {
		return handleFail(errorOut, err)
	}
	n := len(handles)
	if n > int(capacity) {
		n = int(capacity)
	}
	dst := unsafe.Slice((*uint32)(unsafe.Pointer(out)), int(capacity))
	for i := 0; i < n; i++ {
		dst[i] = uint32(handles[i])
	}
	return C.int(len(handles))
}

//export pcgoHandleOpenCursor
func pcgoHandleOpenCursor(sessionID C.uint, root C.uint, declsOnly C.int, errorOut *C.pcgoHandleError) C.uint {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		handleFail(errorOut, asthandle.ErrClosed)
		return 0
	}
	id, err := session.OpenCursor(asthandle.Handle(root), declsOnly != 0)
	if err != nil {
		handleFail(errorOut, err)
		return 0
	}
	return C.uint(id)
}

//export pcgoHandleCursorNext
func pcgoHandleCursorNext(sessionID C.uint, id C.uint, out *C.uint, capacity C.int, errorOut *C.pcgoHandleError) C.int {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		return handleFail(errorOut, asthandle.ErrClosed)
	}
	buf := unsafe.Slice((*asthandle.Handle)(unsafe.Pointer(out)), int(capacity))
	n, err := session.CursorNext(uint32(id), buf)
	if err != nil {
		return handleFail(errorOut, err)
	}
	return C.int(n)
}

//export pcgoHandleCloseCursor
func pcgoHandleCloseCursor(sessionID C.uint, id C.uint, errorOut *C.pcgoHandleError) C.int {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		return handleFail(errorOut, asthandle.ErrClosed)
	}
	if err := session.CloseCursor(uint32(id)); err != nil {
		return handleFail(errorOut, err)
	}
	return 0
}

//export pcgoHandleReadFields
func pcgoHandleReadFields(sessionID C.uint, handles *C.uint, count C.int, field C.int, buf *C.char, capacity C.int, errorOut *C.pcgoHandleError) C.int {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		return handleFail(errorOut, asthandle.ErrClosed)
	}
	ids := unsafe.Slice((*uint32)(unsafe.Pointer(handles)), int(count))
	list := make([]asthandle.Handle, len(ids))
	for i, id := range ids {
		list[i] = asthandle.Handle(id)
	}
	values, err := session.ReadFields(list, asthandle.Field(field))
	if err != nil {
		return handleFail(errorOut, err)
	}
	required := 0
	for _, value := range values {
		required += 4 + len(value)
		if required > math.MaxInt32 {
			return handleFail(errorOut, asthandle.ErrInvalidArgument)
		}
	}
	if required > int(capacity) {
		return C.int(required)
	}
	out := unsafe.Slice((*byte)(unsafe.Pointer(buf)), int(capacity))
	offset := 0
	for _, value := range values {
		if offset+4+len(value) > len(out) {
			return handleFail(errorOut, asthandle.ErrInvalidArgument)
		}
		out[offset] = byte(len(value))
		out[offset+1] = byte(len(value) >> 8)
		out[offset+2] = byte(len(value) >> 16)
		out[offset+3] = byte(len(value) >> 24)
		offset += 4
		offset += copy(out[offset:], value)
	}
	return C.int(offset)
}

//export pcgoHandleSetFields
func pcgoHandleSetFields(sessionID C.uint, handles *C.uint, count C.int, field C.int, buf *C.char, length C.int, errorOut *C.pcgoHandleError) C.int {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		return handleFail(errorOut, asthandle.ErrClosed)
	}
	ids := unsafe.Slice((*uint32)(unsafe.Pointer(handles)), int(count))
	list := make([]asthandle.Handle, len(ids))
	for i, id := range ids {
		list[i] = asthandle.Handle(id)
	}
	payload := unsafe.Slice((*byte)(unsafe.Pointer(buf)), int(length))
	values := make([]string, 0, len(list))
	offset := 0
	for offset < len(payload) {
		if offset+4 > len(payload) {
			return handleFail(errorOut, asthandle.ErrInvalidArgument)
		}
		n := int(payload[offset]) | int(payload[offset+1])<<8 | int(payload[offset+2])<<16 | int(payload[offset+3])<<24
		offset += 4
		if offset+n > len(payload) {
			return handleFail(errorOut, asthandle.ErrInvalidArgument)
		}
		values = append(values, string(payload[offset:offset+n]))
		offset += n
	}
	if err := session.SetFields(list, asthandle.Field(field), values); err != nil {
		return handleFail(errorOut, err)
	}
	return 0
}

//export pcgoHandleNewDecl
func pcgoHandleNewDecl(sessionID C.uint, prop *C.char, propLen C.int, value *C.char, valueLen C.int, errorOut *C.pcgoHandleError) C.uint {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		handleFail(errorOut, asthandle.ErrClosed)
		return 0
	}
	handle, err := session.NewDecl(C.GoStringN(prop, propLen), C.GoStringN(value, valueLen))
	if err != nil {
		handleFail(errorOut, err)
		return 0
	}
	return C.uint(handle)
}

//export pcgoHandleAppend
func pcgoHandleAppend(sessionID C.uint, parent C.uint, child C.uint, errorOut *C.pcgoHandleError) C.int {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		return handleFail(errorOut, asthandle.ErrClosed)
	}
	if err := session.Append(asthandle.Handle(parent), asthandle.Handle(child)); err != nil {
		return handleFail(errorOut, err)
	}
	return 0
}

//export pcgoHandleDispose
func pcgoHandleDispose(sessionID C.uint, handle C.uint, errorOut *C.pcgoHandleError) C.int {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		return handleFail(errorOut, asthandle.ErrClosed)
	}
	if err := session.Dispose(asthandle.Handle(handle)); err != nil {
		return handleFail(errorOut, err)
	}
	return 0
}

//export pcgoHandleStringify
func pcgoHandleStringify(sessionID C.uint, handle C.uint, buf *C.char, capacity C.int, errorOut *C.pcgoHandleError) C.int {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		return handleFail(errorOut, asthandle.ErrClosed)
	}
	css, err := session.Stringify(asthandle.Handle(handle))
	if err != nil {
		return handleFail(errorOut, err)
	}
	return C.int(copyOut(css, buf, capacity))
}

//export pcgoHandleReadSnapshots
func pcgoHandleReadSnapshots(sessionID C.uint, handles *C.uint, count C.int, buf *C.char, capacity C.int, errorOut *C.pcgoHandleError) C.int {
	if count < 0 || uint32(count) > asthandle.MaxBatchSize || capacity < 0 || (count > 0 && handles == nil) || (capacity > 0 && buf == nil) {
		return handleFail(errorOut, asthandle.ErrInvalidArgument)
	}
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		return handleFail(errorOut, asthandle.ErrClosed)
	}
	ids := unsafe.Slice((*uint32)(unsafe.Pointer(handles)), int(count))
	list := make([]asthandle.Handle, len(ids))
	for i, id := range ids {
		list[i] = asthandle.Handle(id)
	}
	rows, err := session.ReadSnapshots(list)
	if err != nil {
		return handleFail(errorOut, err)
	}
	encoded, err := json.Marshal(rows)
	if err != nil {
		return handleFail(errorOut, err)
	}
	if len(encoded) > math.MaxInt32 {
		return handleFail(errorOut, asthandle.ErrInvalidArgument)
	}
	if len(encoded) <= int(capacity) {
		copy(unsafe.Slice((*byte)(unsafe.Pointer(buf)), int(capacity)), encoded)
	}
	return C.int(len(encoded))
}

//export pcgoHandleApplyPatches
func pcgoHandleApplyPatches(
	sessionID C.uint,
	handles *C.uint,
	fields *C.int,
	count C.int,
	buf *C.char,
	length C.int,
	errorOut *C.pcgoHandleError,
) C.int {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		return handleFail(errorOut, asthandle.ErrClosed)
	}
	ids := unsafe.Slice((*uint32)(unsafe.Pointer(handles)), int(count))
	fieldIDs := unsafe.Slice((*int32)(unsafe.Pointer(fields)), int(count))
	payload := unsafe.Slice((*byte)(unsafe.Pointer(buf)), int(length))
	values := make([]string, 0, len(ids))
	offset := 0
	for offset < len(payload) {
		if offset+4 > len(payload) {
			return handleFail(errorOut, asthandle.ErrInvalidArgument)
		}
		n := int(payload[offset]) | int(payload[offset+1])<<8 | int(payload[offset+2])<<16 | int(payload[offset+3])<<24
		offset += 4
		if n < 0 || offset+n > len(payload) {
			return handleFail(errorOut, asthandle.ErrInvalidArgument)
		}
		values = append(values, string(payload[offset:offset+n]))
		offset += n
	}
	if len(values) != len(ids) {
		return handleFail(errorOut, asthandle.ErrInvalidArgument)
	}
	patches := make([]asthandle.FieldPatch, len(ids))
	for i, id := range ids {
		patches[i] = asthandle.FieldPatch{
			Handle: asthandle.Handle(id),
			Field:  asthandle.Field(fieldIDs[i]),
			Value:  values[i],
		}
	}
	if err := session.ApplyPatches(patches); err != nil {
		return handleFail(errorOut, err)
	}
	return 0
}

//export pcgoHandleInsertBefore
func pcgoHandleInsertBefore(sessionID C.uint, target C.uint, child C.uint, errorOut *C.pcgoHandleError) C.int {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		return handleFail(errorOut, asthandle.ErrClosed)
	}
	if err := session.InsertBefore(asthandle.Handle(target), asthandle.Handle(child)); err != nil {
		return handleFail(errorOut, err)
	}
	return 0
}

//export pcgoHandleRemove
func pcgoHandleRemove(sessionID C.uint, handle C.uint, errorOut *C.pcgoHandleError) C.int {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		return handleFail(errorOut, asthandle.ErrClosed)
	}
	if err := session.Remove(asthandle.Handle(handle)); err != nil {
		return handleFail(errorOut, err)
	}
	return 0
}

//export pcgoHandleClone
func pcgoHandleClone(sessionID C.uint, handle C.uint, errorOut *C.pcgoHandleError) C.uint {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		handleFail(errorOut, asthandle.ErrClosed)
		return 0
	}
	id, err := session.Clone(asthandle.Handle(handle))
	if err != nil {
		handleFail(errorOut, err)
		return 0
	}
	return C.uint(id)
}

//export pcgoHandlePrepend
func pcgoHandlePrepend(sessionID C.uint, parent C.uint, child C.uint, errorOut *C.pcgoHandleError) C.int {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		return handleFail(errorOut, asthandle.ErrClosed)
	}
	if err := session.Prepend(asthandle.Handle(parent), asthandle.Handle(child)); err != nil {
		return handleFail(errorOut, err)
	}
	return 0
}

//export pcgoHandleInsertAfter
func pcgoHandleInsertAfter(sessionID C.uint, target C.uint, child C.uint, errorOut *C.pcgoHandleError) C.int {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		return handleFail(errorOut, asthandle.ErrClosed)
	}
	if err := session.InsertAfter(asthandle.Handle(target), asthandle.Handle(child)); err != nil {
		return handleFail(errorOut, err)
	}
	return 0
}

//export pcgoHandleReplaceWith
func pcgoHandleReplaceWith(sessionID C.uint, target C.uint, handles *C.uint, count C.int, errorOut *C.pcgoHandleError) C.int {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		return handleFail(errorOut, asthandle.ErrClosed)
	}
	ids := unsafe.Slice((*uint32)(unsafe.Pointer(handles)), int(count))
	list := make([]asthandle.Handle, len(ids))
	for i, id := range ids {
		list[i] = asthandle.Handle(id)
	}
	if err := session.ReplaceWith(asthandle.Handle(target), list...); err != nil {
		return handleFail(errorOut, err)
	}
	return 0
}

//export pcgoHandleNewRule
func pcgoHandleNewRule(sessionID C.uint, selector *C.char, selectorLen C.int, errorOut *C.pcgoHandleError) C.uint {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		handleFail(errorOut, asthandle.ErrClosed)
		return 0
	}
	id, err := session.NewRule(C.GoStringN(selector, selectorLen))
	if err != nil {
		handleFail(errorOut, err)
		return 0
	}
	return C.uint(id)
}

//export pcgoHandleNewAtRule
func pcgoHandleNewAtRule(sessionID C.uint, name *C.char, nameLen C.int, params *C.char, paramsLen C.int, errorOut *C.pcgoHandleError) C.uint {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		handleFail(errorOut, asthandle.ErrClosed)
		return 0
	}
	id, err := session.NewAtRule(C.GoStringN(name, nameLen), C.GoStringN(params, paramsLen))
	if err != nil {
		handleFail(errorOut, err)
		return 0
	}
	return C.uint(id)
}

//export pcgoHandleNewComment
func pcgoHandleNewComment(sessionID C.uint, text *C.char, textLen C.int, errorOut *C.pcgoHandleError) C.uint {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		handleFail(errorOut, asthandle.ErrClosed)
		return 0
	}
	id, err := session.NewComment(C.GoStringN(text, textLen))
	if err != nil {
		handleFail(errorOut, err)
		return 0
	}
	return C.uint(id)
}

//export pcgoHandleSetRaw
func pcgoHandleSetRaw(sessionID C.uint, handle C.uint, patchJSON *C.char, patchLen C.int, errorOut *C.pcgoHandleError) C.int {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		return handleFail(errorOut, asthandle.ErrClosed)
	}
	var patch asthandle.RawPatch
	if err := json.Unmarshal([]byte(C.GoStringN(patchJSON, patchLen)), &patch); err != nil {
		return handleFail(errorOut, asthandle.ErrInvalidArgument)
	}
	if err := session.SetRaw(asthandle.Handle(handle), patch); err != nil {
		return handleFail(errorOut, err)
	}
	return 0
}

//export pcgoHandleGetRaws
func pcgoHandleGetRaws(sessionID C.uint, handle C.uint, buf *C.char, capacity C.int, errorOut *C.pcgoHandleError) C.int {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		return handleFail(errorOut, asthandle.ErrClosed)
	}
	value, err := session.GetRawsJSON(asthandle.Handle(handle))
	if err != nil {
		return handleFail(errorOut, err)
	}
	return C.int(copyOut(value, buf, capacity))
}

//export pcgoHandleStringifyMap
func pcgoHandleStringifyMap(sessionID C.uint, handle C.uint, optionsJSON *C.char, optionsLen C.int, buf *C.char, capacity C.int, errorOut *C.pcgoHandleError) C.int {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		return handleFail(errorOut, asthandle.ErrClosed)
	}
	var opts struct {
		From               string `json:"from"`
		To                 string `json:"to"`
		MapFile            string `json:"mapFile"`
		Absolute           bool   `json:"absolute"`
		PreserveAnnotation bool   `json:"preserveAnnotation"`
	}
	if optionsJSON != nil && optionsLen > 0 {
		if err := json.Unmarshal([]byte(C.GoStringN(optionsJSON, optionsLen)), &opts); err != nil {
			return handleFail(errorOut, asthandle.ErrInvalidArgument)
		}
	}
	css, mapJSON, err := session.StringifyMap(asthandle.Handle(handle), stringifier.SourceMapOptions{
		From: opts.From, To: opts.To, MapFile: opts.MapFile, Absolute: opts.Absolute, PreserveAnnotation: opts.PreserveAnnotation,
	})
	if err != nil {
		return handleFail(errorOut, err)
	}
	encoded, err := json.Marshal(map[string]string{"css": css, "map": mapJSON})
	if err != nil {
		return handleFail(errorOut, asthandle.ErrInvalidArgument)
	}
	if len(encoded) > math.MaxInt32 {
		return handleFail(errorOut, asthandle.ErrInvalidArgument)
	}
	if len(encoded) <= int(capacity) {
		copy(unsafe.Slice((*byte)(unsafe.Pointer(buf)), int(capacity)), encoded)
	}
	return C.int(len(encoded))
}

//export pcgoHandleParent
func pcgoHandleParent(sessionID C.uint, handle C.uint, errorOut *C.pcgoHandleError) C.uint {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		handleFail(errorOut, asthandle.ErrClosed)
		return 0
	}
	parent, err := session.Parent(asthandle.Handle(handle))
	if err != nil {
		handleFail(errorOut, err)
		return 0
	}
	return C.uint(parent)
}

//export pcgoHandleChildCount
func pcgoHandleChildCount(sessionID C.uint, handle C.uint, errorOut *C.pcgoHandleError) C.int {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		return handleFail(errorOut, asthandle.ErrClosed)
	}
	count, err := session.ChildCount(asthandle.Handle(handle))
	if err != nil {
		return handleFail(errorOut, err)
	}
	return C.int(count)
}

//export pcgoHandleChildAt
func pcgoHandleChildAt(sessionID C.uint, handle C.uint, index C.int, errorOut *C.pcgoHandleError) C.uint {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		handleFail(errorOut, asthandle.ErrClosed)
		return 0
	}
	child, err := session.ChildAt(asthandle.Handle(handle), int(index))
	if err != nil {
		handleFail(errorOut, err)
		return 0
	}
	return C.uint(child)
}

//export pcgoHandleStringifyBuilder
func pcgoHandleStringifyBuilder(sessionID C.uint, handle C.uint, buf *C.char, capacity C.int, errorOut *C.pcgoHandleError) C.int {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		return handleFail(errorOut, asthandle.ErrClosed)
	}
	value, err := session.StringifyBuilder(asthandle.Handle(handle))
	if err != nil {
		return handleFail(errorOut, err)
	}
	return C.int(copyOut(value, buf, capacity))
}

//export pcgoHandleQuery
func pcgoHandleQuery(sessionID C.uint, handle C.uint, kind *C.char, kindLen C.int, optionsJSON *C.char, optionsLen C.int, buf *C.char, capacity C.int, errorOut *C.pcgoHandleError) C.int {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		return handleFail(errorOut, asthandle.ErrClosed)
	}
	kindName := ""
	if kind != nil && kindLen > 0 {
		kindName = C.GoStringN(kind, kindLen)
	}
	options := ""
	if optionsJSON != nil && optionsLen > 0 {
		options = C.GoStringN(optionsJSON, optionsLen)
	}
	value, err := session.Query(asthandle.Handle(handle), kindName, options)
	if err != nil {
		return handleFail(errorOut, err)
	}
	return C.int(copyOut(value, buf, capacity))
}
