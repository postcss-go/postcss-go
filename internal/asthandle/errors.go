package asthandle

import "errors"

// ErrorStatus maps Go errors to stable ABI values without retaining global state.
func ErrorStatus(err error) uint32 {
	if err == nil {
		return StatusOK
	}
	for _, item := range []struct {
		err    error
		status uint32
	}{
		{ErrInvalidHandle, StatusInvalidHandle}, {ErrStaleHandle, StatusStaleHandle}, {ErrClosed, StatusClosed},
		{ErrNotContainer, StatusNotContainer}, {ErrBadField, StatusBadField}, {ErrCursor, StatusCursor},
		{ErrParse, StatusParse}, {ErrCycle, StatusCycle}, {ErrExhausted, StatusExhausted}, {ErrInvalidArgument, StatusInvalidArgument},
	} {
		if errors.Is(err, item.err) {
			return item.status
		}
	}
	return StatusInternal
}
