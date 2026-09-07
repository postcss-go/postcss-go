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
	"io"
	"math"
	"strings"
	"unsafe"

	"github.com/postcss-go/postcss-go/internal/asthandle"
)

var handleSessions asthandle.Registry

//export pcgoHandleFreeErrorV2_1
func pcgoHandleFreeErrorV2_1(out *C.pcgoHandleError) {
	if out != nil {
		C.free(unsafe.Pointer(out.message))
		out.message = nil
		out.length = 0
	}
}

//export pcgoHandleSessionCountV2
func pcgoHandleSessionCountV2() C.uint { return C.uint(handleSessions.Len()) }

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

//export pcgoHandleParseV2_1
func pcgoHandleParseV2_1(buf *C.char, length C.int, rootOut *C.uint, optionsJSON *C.char, optionsLength C.int, errorOut *C.pcgoHandleError) C.uint {
	css := C.GoStringN(buf, length)
	var options *struct {
		From        string `json:"from"`
		Document    string `json:"document"`
		TrackSource bool   `json:"trackSource"`
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
		parseOptions = sourcemap.Options{From: options.From, Document: options.Document, TrackSource: options.TrackSource}
	}
	id, root, err := handleSessions.ParseWithOptions(css, parseOptions)
	if err != nil {
		handleFail(errorOut, err)
		return 0
	}
	*rootOut = C.uint(root)
	return C.uint(id)
}

//export pcgoHandleCloseV2
func pcgoHandleCloseV2(id C.uint) {
	handleSessions.Close(uint32(id))
}

//export pcgoHandleTypeV2_1
func pcgoHandleTypeV2_1(sessionID C.uint, handle C.uint, errorOut *C.pcgoHandleError) C.int {
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

//export pcgoHandleGetFieldV2_1
func pcgoHandleGetFieldV2_1(sessionID C.uint, handle C.uint, field C.int, buf *C.char, capacity C.int, errorOut *C.pcgoHandleError) C.int {
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

//export pcgoHandleSetFieldV2_1
func pcgoHandleSetFieldV2_1(sessionID C.uint, handle C.uint, field C.int, buf *C.char, length C.int, errorOut *C.pcgoHandleError) C.int {
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

//export pcgoHandleWalkDeclsV2_1
func pcgoHandleWalkDeclsV2_1(sessionID C.uint, root C.uint, out *C.uint, capacity C.int, errorOut *C.pcgoHandleError) C.int {
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

//export pcgoHandleOpenCursorV2_1
func pcgoHandleOpenCursorV2_1(sessionID C.uint, root C.uint, declsOnly C.int, errorOut *C.pcgoHandleError) C.uint {
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

//export pcgoHandleCursorNextV2_1
func pcgoHandleCursorNextV2_1(sessionID C.uint, id C.uint, out *C.uint, capacity C.int, errorOut *C.pcgoHandleError) C.int {
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

//export pcgoHandleCloseCursorV2_1
func pcgoHandleCloseCursorV2_1(sessionID C.uint, id C.uint, errorOut *C.pcgoHandleError) C.int {
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

//export pcgoHandleReadFieldsV2_1
func pcgoHandleReadFieldsV2_1(sessionID C.uint, handles *C.uint, count C.int, field C.int, buf *C.char, capacity C.int, errorOut *C.pcgoHandleError) C.int {
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

//export pcgoHandleSetFieldsV2_1
func pcgoHandleSetFieldsV2_1(sessionID C.uint, handles *C.uint, count C.int, field C.int, buf *C.char, length C.int, errorOut *C.pcgoHandleError) C.int {
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

//export pcgoHandleNewDeclV2_1
func pcgoHandleNewDeclV2_1(sessionID C.uint, prop *C.char, propLen C.int, value *C.char, valueLen C.int, errorOut *C.pcgoHandleError) C.uint {
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

//export pcgoHandleAppendV2_1
func pcgoHandleAppendV2_1(sessionID C.uint, parent C.uint, child C.uint, errorOut *C.pcgoHandleError) C.int {
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

//export pcgoHandleDisposeV2_1
func pcgoHandleDisposeV2_1(sessionID C.uint, handle C.uint, errorOut *C.pcgoHandleError) C.int {
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

//export pcgoHandleStringifyV2_1
func pcgoHandleStringifyV2_1(sessionID C.uint, handle C.uint, buf *C.char, capacity C.int, errorOut *C.pcgoHandleError) C.int {
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
