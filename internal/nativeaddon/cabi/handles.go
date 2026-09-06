//go:build nativeaddon

package main

import "C"

import (
	"math"
	"unsafe"

	"github.com/postcss-go/postcss-go/internal/asthandle"
)

var handleSessions asthandle.Registry

//export pcgoHandleSessionCountV2
func pcgoHandleSessionCountV2() C.uint { return C.uint(handleSessions.Len()) }

func handleFail() C.int {
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

//export pcgoHandleParseV2
func pcgoHandleParseV2(buf *C.char, length C.int, rootOut *C.uint) C.uint {
	css := C.GoStringN(buf, length)
	id, root, err := handleSessions.Parse(css)
	if err != nil {
		return 0
	}
	*rootOut = C.uint(root)
	return C.uint(id)
}

//export pcgoHandleCloseV2
func pcgoHandleCloseV2(id C.uint) {
	handleSessions.Close(uint32(id))
}

//export pcgoHandleTypeV2
func pcgoHandleTypeV2(sessionID C.uint, handle C.uint) C.int {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		return handleFail()
	}
	kind, err := session.Type(asthandle.Handle(handle))
	if err != nil {
		return handleFail()
	}
	return C.int(kind)
}

//export pcgoHandleGetFieldV2
func pcgoHandleGetFieldV2(sessionID C.uint, handle C.uint, field C.int, buf *C.char, capacity C.int) C.int {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		return handleFail()
	}
	value, err := session.GetField(asthandle.Handle(handle), asthandle.Field(field))
	if err != nil {
		return handleFail()
	}
	return C.int(copyOut(value, buf, capacity))
}

//export pcgoHandleSetFieldV2
func pcgoHandleSetFieldV2(sessionID C.uint, handle C.uint, field C.int, buf *C.char, length C.int) C.int {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		return handleFail()
	}
	if err := session.SetField(asthandle.Handle(handle), asthandle.Field(field), C.GoStringN(buf, length)); err != nil {
		return handleFail()
	}
	return 0
}

//export pcgoHandleWalkDeclsV2
func pcgoHandleWalkDeclsV2(sessionID C.uint, root C.uint, out *C.uint, capacity C.int) C.int {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		return handleFail()
	}
	handles, err := session.Collect(asthandle.Handle(root), true)
	if err != nil {
		return handleFail()
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

//export pcgoHandleOpenCursorV2
func pcgoHandleOpenCursorV2(sessionID C.uint, root C.uint, declsOnly C.int) C.int {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		return handleFail()
	}
	id, err := session.OpenCursor(asthandle.Handle(root), declsOnly != 0)
	if err != nil {
		return handleFail()
	}
	return C.int(id)
}

//export pcgoHandleCursorNextV2
func pcgoHandleCursorNextV2(sessionID C.uint, id C.int, out *C.uint, capacity C.int) C.int {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		return handleFail()
	}
	buf := unsafe.Slice((*asthandle.Handle)(unsafe.Pointer(out)), int(capacity))
	n, err := session.CursorNext(int(id), buf)
	if err != nil {
		return handleFail()
	}
	return C.int(n)
}

//export pcgoHandleCloseCursorV2
func pcgoHandleCloseCursorV2(sessionID C.uint, id C.int) C.int {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		return handleFail()
	}
	if err := session.CloseCursor(int(id)); err != nil {
		return handleFail()
	}
	return 0
}

//export pcgoHandleReadFieldsV2
func pcgoHandleReadFieldsV2(sessionID C.uint, handles *C.uint, count C.int, field C.int, buf *C.char, capacity C.int) C.int {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		return handleFail()
	}
	ids := unsafe.Slice((*uint32)(unsafe.Pointer(handles)), int(count))
	list := make([]asthandle.Handle, len(ids))
	for i, id := range ids {
		list[i] = asthandle.Handle(id)
	}
	values, err := session.ReadFields(list, asthandle.Field(field))
	if err != nil {
		return handleFail()
	}
	required := 0
	for _, value := range values {
		required += 4 + len(value)
		if required > math.MaxInt32 {
			return handleFail()
		}
	}
	if required > int(capacity) {
		return C.int(required)
	}
	out := unsafe.Slice((*byte)(unsafe.Pointer(buf)), int(capacity))
	offset := 0
	for _, value := range values {
		if offset+4+len(value) > len(out) {
			return handleFail()
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

//export pcgoHandleSetFieldsV2
func pcgoHandleSetFieldsV2(sessionID C.uint, handles *C.uint, count C.int, field C.int, buf *C.char, length C.int) C.int {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		return handleFail()
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
			return handleFail()
		}
		n := int(payload[offset]) | int(payload[offset+1])<<8 | int(payload[offset+2])<<16 | int(payload[offset+3])<<24
		offset += 4
		if offset+n > len(payload) {
			return handleFail()
		}
		values = append(values, string(payload[offset:offset+n]))
		offset += n
	}
	if err := session.SetFields(list, asthandle.Field(field), values); err != nil {
		return handleFail()
	}
	return 0
}

//export pcgoHandleNewDeclV2
func pcgoHandleNewDeclV2(sessionID C.uint, prop *C.char, propLen C.int, value *C.char, valueLen C.int) C.uint {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		return 0
	}
	handle, err := session.NewDecl(C.GoStringN(prop, propLen), C.GoStringN(value, valueLen))
	if err != nil {
		return 0
	}
	return C.uint(handle)
}

//export pcgoHandleAppendV2
func pcgoHandleAppendV2(sessionID C.uint, parent C.uint, child C.uint) C.int {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		return handleFail()
	}
	if err := session.Append(asthandle.Handle(parent), asthandle.Handle(child)); err != nil {
		return handleFail()
	}
	return 0
}

//export pcgoHandleDisposeV2
func pcgoHandleDisposeV2(sessionID C.uint, handle C.uint) C.int {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		return handleFail()
	}
	if err := session.Dispose(asthandle.Handle(handle)); err != nil {
		return handleFail()
	}
	return 0
}

//export pcgoHandleStringifyV2
func pcgoHandleStringifyV2(sessionID C.uint, handle C.uint, buf *C.char, capacity C.int) C.int {
	session, release := handleSessions.Acquire(uint32(sessionID))
	defer release()
	if session == nil {
		return handleFail()
	}
	css, err := session.Stringify(asthandle.Handle(handle))
	if err != nil {
		return handleFail()
	}
	return C.int(copyOut(css, buf, capacity))
}
