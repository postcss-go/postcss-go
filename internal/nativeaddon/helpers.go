// Package nativeaddon holds the pure-Go side of the Node-API native library:
// payload fitting and the structured error text written into the N-API error
// slot. The C ABI is in the cabi subdirectory.
package nativeaddon

import (
	"encoding/json"
	"errors"

	"postcss-go/internal/csserrors"
	"postcss-go/internal/jsbridge"
)

const cssSyntaxErrorPrefix = "postcss-go:css-syntax:"

// FitPayload copies payload into out when out is large enough, and always
// returns the payload size so callers can grow the buffer.
func FitPayload(out []byte, payload []byte) int {
	if len(out) >= len(payload) {
		copy(out, payload)
	}
	return len(payload)
}

// WriteErrorBytes writes the native error text into buf. An empty buf reports
// the required size without writing.
func WriteErrorBytes(buf []byte, err error) int {
	message := nativeErrorMessage(err)
	if len(buf) == 0 {
		return len(message)
	}
	return copy(buf, message)
}

func nativeErrorMessage(err error) string {
	var syntaxError *csserrors.SyntaxError
	if !errors.As(err, &syntaxError) {
		return err.Error()
	}
	// Omit source text so the 4KiB N-API error slot stays structured.
	detail := jsbridge.ErrorDTOFromError(err)
	detail.Source = ""
	if detail.Input != nil {
		detail.Input.Source = ""
	}
	payload, marshalErr := json.Marshal(detail)
	if marshalErr != nil {
		return cssSyntaxErrorPrefix + err.Error()
	}
	return cssSyntaxErrorPrefix + string(payload)
}
