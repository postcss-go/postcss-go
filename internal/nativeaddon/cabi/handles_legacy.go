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
import "unsafe"

// V2.0 C entry points retain their original signatures for mixed package rollback.
// The production addon uses V2_1 and never interprets a legacy sentinel as success.

//export pcgoHandleParseV2
func pcgoHandleParseV2(buf *C.char, length C.int, rootOut *C.uint) C.uint {
	var detail C.pcgoHandleError
	result := pcgoHandleParseV2_1(buf, length, rootOut, nil, 0, &detail)
	C.free(unsafe.Pointer(detail.message))
	return C.uint(result)
}

//export pcgoHandleTypeV2
func pcgoHandleTypeV2(sessionID C.uint, handle C.uint) C.int {
	var detail C.pcgoHandleError
	result := pcgoHandleTypeV2_1(sessionID, handle, &detail)
	C.free(unsafe.Pointer(detail.message))
	return C.int(result)
}

//export pcgoHandleGetFieldV2
func pcgoHandleGetFieldV2(sessionID C.uint, handle C.uint, field C.int, buf *C.char, capacity C.int) C.int {
	var detail C.pcgoHandleError
	result := pcgoHandleGetFieldV2_1(sessionID, handle, field, buf, capacity, &detail)
	C.free(unsafe.Pointer(detail.message))
	return C.int(result)
}

//export pcgoHandleSetFieldV2
func pcgoHandleSetFieldV2(sessionID C.uint, handle C.uint, field C.int, buf *C.char, length C.int) C.int {
	var detail C.pcgoHandleError
	result := pcgoHandleSetFieldV2_1(sessionID, handle, field, buf, length, &detail)
	C.free(unsafe.Pointer(detail.message))
	return C.int(result)
}

//export pcgoHandleWalkDeclsV2
func pcgoHandleWalkDeclsV2(sessionID C.uint, root C.uint, out *C.uint, capacity C.int) C.int {
	var detail C.pcgoHandleError
	result := pcgoHandleWalkDeclsV2_1(sessionID, root, out, capacity, &detail)
	C.free(unsafe.Pointer(detail.message))
	return C.int(result)
}

//export pcgoHandleOpenCursorV2
func pcgoHandleOpenCursorV2(sessionID C.uint, root C.uint, declsOnly C.int) C.int {
	var detail C.pcgoHandleError
	result := pcgoHandleOpenCursorV2_1(sessionID, root, declsOnly, &detail)
	C.free(unsafe.Pointer(detail.message))
	if result == 0 {
		return -1
	}
	if uint64(result) > 0x7fffffff {
		var ignored C.pcgoHandleError
		pcgoHandleCloseCursorV2_1(sessionID, result, &ignored)
		C.free(unsafe.Pointer(ignored.message))
		return -1
	}
	return C.int(result)
}

//export pcgoHandleCursorNextV2
func pcgoHandleCursorNextV2(sessionID C.uint, id C.int, out *C.uint, capacity C.int) C.int {
	var detail C.pcgoHandleError
	result := pcgoHandleCursorNextV2_1(sessionID, C.uint(id), out, capacity, &detail)
	C.free(unsafe.Pointer(detail.message))
	return C.int(result)
}

//export pcgoHandleCloseCursorV2
func pcgoHandleCloseCursorV2(sessionID C.uint, id C.int) C.int {
	var detail C.pcgoHandleError
	result := pcgoHandleCloseCursorV2_1(sessionID, C.uint(id), &detail)
	C.free(unsafe.Pointer(detail.message))
	return C.int(result)
}

//export pcgoHandleReadFieldsV2
func pcgoHandleReadFieldsV2(sessionID C.uint, handles *C.uint, count C.int, field C.int, buf *C.char, capacity C.int) C.int {
	var detail C.pcgoHandleError
	result := pcgoHandleReadFieldsV2_1(sessionID, handles, count, field, buf, capacity, &detail)
	C.free(unsafe.Pointer(detail.message))
	return C.int(result)
}

//export pcgoHandleSetFieldsV2
func pcgoHandleSetFieldsV2(sessionID C.uint, handles *C.uint, count C.int, field C.int, buf *C.char, length C.int) C.int {
	var detail C.pcgoHandleError
	result := pcgoHandleSetFieldsV2_1(sessionID, handles, count, field, buf, length, &detail)
	C.free(unsafe.Pointer(detail.message))
	return C.int(result)
}

//export pcgoHandleNewDeclV2
func pcgoHandleNewDeclV2(sessionID C.uint, prop *C.char, propLen C.int, value *C.char, valueLen C.int) C.uint {
	var detail C.pcgoHandleError
	result := pcgoHandleNewDeclV2_1(sessionID, prop, propLen, value, valueLen, &detail)
	C.free(unsafe.Pointer(detail.message))
	return C.uint(result)
}

//export pcgoHandleAppendV2
func pcgoHandleAppendV2(sessionID C.uint, parent C.uint, child C.uint) C.int {
	var detail C.pcgoHandleError
	result := pcgoHandleAppendV2_1(sessionID, parent, child, &detail)
	C.free(unsafe.Pointer(detail.message))
	return C.int(result)
}

//export pcgoHandleDisposeV2
func pcgoHandleDisposeV2(sessionID C.uint, handle C.uint) C.int {
	var detail C.pcgoHandleError
	result := pcgoHandleDisposeV2_1(sessionID, handle, &detail)
	C.free(unsafe.Pointer(detail.message))
	return C.int(result)
}

//export pcgoHandleStringifyV2
func pcgoHandleStringifyV2(sessionID C.uint, handle C.uint, buf *C.char, capacity C.int) C.int {
	var detail C.pcgoHandleError
	result := pcgoHandleStringifyV2_1(sessionID, handle, buf, capacity, &detail)
	C.free(unsafe.Pointer(detail.message))
	return C.int(result)
}
