package ast

type rawFlag uint16

const (
	rawFlagBefore rawFlag = 1 << iota
	rawFlagAfter
	rawFlagBetween
	rawFlagSemicolon
	rawFlagOwnSemicolon
	rawFlagAfterName
	rawFlagImportant
	rawFlagLeft
	rawFlagRight
	rawFlagSelector
	rawFlagValue
	rawFlagParams
	rawFlagIndent
)

func baseNode(node Node) *BaseNode {
	switch current := node.(type) {
	case *Document:
		return &current.BaseNode
	case *Root:
		return &current.BaseNode
	case *Rule:
		return &current.BaseNode
	case *AtRule:
		return &current.BaseNode
	case *Declaration:
		return &current.BaseNode
	case *Comment:
		return &current.BaseNode
	default:
		return nil
	}
}

var compactRawKeyOrder = [...]string{
	"before", "after", "between", "semicolon", "ownSemicolon", "afterName",
	"important", "left", "right", "selector", "value", "params", "indent",
}

func isCompactRawKey(key string) bool {
	switch key {
	case "before", "after", "between", "semicolon", "ownSemicolon", "afterName",
		"important", "left", "right", "selector", "value", "params", "indent":
		return true
	default:
		return false
	}
}

// VisitRaws calls fn for every set formatting raw without allocating a key list
// or a seen-map. fn should return false to stop. Compact keys are visited in a
// stable order; overflow map keys follow in map iteration order.
func VisitRaws(node Node, fn func(key string, value any) bool) {
	base := baseNode(node)
	if base == nil {
		return
	}
	if base.rawsMaterialized && base.Raws != nil {
		for key, value := range base.Raws {
			if value == nil {
				continue
			}
			if !fn(key, value) {
				return
			}
		}
		return
	}
	for _, key := range compactRawKeyOrder {
		if !base.hasRaw(key) {
			continue
		}
		value, ok := base.lookupRaw(key)
		if !ok {
			continue
		}
		if !fn(key, value) {
			return
		}
	}
	if base.Raws == nil {
		return
	}
	for key, value := range base.Raws {
		if value == nil || isCompactRawKey(key) {
			continue
		}
		if !fn(key, value) {
			return
		}
	}
}

// CountRaws returns the number of set formatting raws without allocating.
func CountRaws(node Node) int {
	count := 0
	VisitRaws(node, func(string, any) bool {
		count++
		return true
	})
	return count
}

// ApplyRaw stores a decoded raw on node using compact fields when the key is
// a known string/bool/RawValue slot, otherwise the overflow map.
func ApplyRaw(node Node, key string, value any) {
	if value == nil {
		if base := baseNode(node); base != nil {
			base.ensureRaws()[key] = nil
		}
		return
	}
	switch current := value.(type) {
	case string:
		SetRawString(node, key, current)
	case bool:
		SetRawBool(node, key, current)
	case RawValue:
		SetRawValue(node, key, current)
	case *RawValue:
		if current == nil {
			if base := baseNode(node); base != nil {
				base.ensureRaws()[key] = nil
			}
			return
		}
		SetRawValue(node, key, *current)
	default:
		if base := baseNode(node); base != nil {
			base.ensureRaws()[key] = value
		}
	}
}

// RawKeys returns every formatting key set on node without materializing compact
// storage into a map.
func RawKeys(node Node) []string {
	if baseNode(node) == nil {
		return nil
	}
	keys := make([]string, 0, CountRaws(node))
	VisitRaws(node, func(key string, _ any) bool {
		keys = append(keys, key)
		return true
	})
	return keys
}

// HasRaw reports whether a formatting raw is set without boxing stored values.
func HasRaw(node Node, key string) bool {
	base := baseNode(node)
	if base == nil {
		return false
	}
	return base.hasRaw(key)
}

// LookupRawString returns a string raw without interface boxing.
func LookupRawString(node Node, key string) (string, bool) {
	base := baseNode(node)
	if base == nil {
		return "", false
	}
	return base.lookupRawString(key)
}

// LookupRawBool returns a boolean raw without interface boxing.
func LookupRawBool(node Node, key string) (bool, bool) {
	base := baseNode(node)
	if base == nil {
		return false, false
	}
	return base.lookupRawBool(key)
}

// LookupRaw returns a formatting raw when explicitly set on the node.
func LookupRaw(node Node, key string) (any, bool) {
	base := baseNode(node)
	if base == nil {
		return nil, false
	}
	return base.lookupRaw(key)
}

func (n *BaseNode) hasRaw(key string) bool {
	if n.rawsMaterialized && n.Raws != nil {
		value, ok := n.Raws[key]
		return ok && value != nil
	}
	switch key {
	case "before":
		if n.rawFlags&rawFlagBefore != 0 {
			return true
		}
	case "after":
		if n.rawFlags&rawFlagAfter != 0 {
			return true
		}
	case "between":
		if n.rawFlags&rawFlagBetween != 0 {
			return true
		}
	case "semicolon":
		if n.rawFlags&rawFlagSemicolon != 0 {
			return true
		}
	case "ownSemicolon":
		if n.rawFlags&rawFlagOwnSemicolon != 0 {
			return true
		}
	case "afterName":
		if n.rawFlags&rawFlagAfterName != 0 {
			return true
		}
	case "important":
		if n.rawFlags&rawFlagImportant != 0 {
			return true
		}
	case "left":
		if n.rawFlags&rawFlagLeft != 0 {
			return true
		}
	case "right":
		if n.rawFlags&rawFlagRight != 0 {
			return true
		}
	case "indent":
		if n.rawFlags&rawFlagIndent != 0 {
			return true
		}
	case "selector":
		if n.rawFlags&rawFlagSelector != 0 {
			return true
		}
	case "value":
		if n.rawFlags&rawFlagValue != 0 {
			return true
		}
	case "params":
		if n.rawFlags&rawFlagParams != 0 {
			return true
		}
	}
	if n.Raws == nil {
		return false
	}
	value, ok := n.Raws[key]
	return ok && value != nil
}

func (n *BaseNode) lookupRawString(key string) (string, bool) {
	if n.rawsMaterialized && n.Raws != nil {
		value, ok := n.Raws[key]
		if !ok || value == nil {
			return "", false
		}
		text, ok := value.(string)
		return text, ok
	}
	switch key {
	case "before":
		if n.rawFlags&rawFlagBefore != 0 {
			return n.rawBefore, true
		}
	case "after":
		if n.rawFlags&rawFlagAfter != 0 {
			return n.rawAfter, true
		}
	case "between":
		if n.rawFlags&rawFlagBetween != 0 {
			return n.rawBetween, true
		}
	case "ownSemicolon":
		if n.rawFlags&rawFlagOwnSemicolon != 0 {
			return n.rawOwnSemicolon, true
		}
	case "afterName":
		if n.rawFlags&rawFlagAfterName != 0 {
			return n.rawAfterName, true
		}
	case "important":
		if n.rawFlags&rawFlagImportant != 0 {
			return n.rawImportant, true
		}
	case "left":
		if n.rawFlags&rawFlagLeft != 0 {
			return n.rawLeft, true
		}
	case "right":
		if n.rawFlags&rawFlagRight != 0 {
			return n.rawRight, true
		}
	case "indent":
		if n.rawFlags&rawFlagIndent != 0 {
			return n.rawIndent, true
		}
	}
	if n.Raws == nil {
		return "", false
	}
	value, ok := n.Raws[key]
	if !ok || value == nil {
		return "", false
	}
	text, ok := value.(string)
	return text, ok
}

func (n *BaseNode) lookupRawBool(key string) (bool, bool) {
	if n.rawsMaterialized && n.Raws != nil {
		value, ok := n.Raws[key]
		if !ok || value == nil {
			return false, false
		}
		boolean, ok := value.(bool)
		return boolean, ok
	}
	if key == "semicolon" && n.rawFlags&rawFlagSemicolon != 0 {
		return n.rawSemicolon, true
	}
	if n.Raws == nil {
		return false, false
	}
	value, ok := n.Raws[key]
	if !ok || value == nil {
		return false, false
	}
	boolean, ok := value.(bool)
	return boolean, ok
}

func (n *BaseNode) lookupRaw(key string) (any, bool) {
	if n.rawsMaterialized && n.Raws != nil {
		value, ok := n.Raws[key]
		if !ok || value == nil {
			return nil, false
		}
		return value, true
	}
	switch key {
	case "before":
		if n.rawFlags&rawFlagBefore != 0 {
			return n.rawBefore, true
		}
	case "after":
		if n.rawFlags&rawFlagAfter != 0 {
			return n.rawAfter, true
		}
	case "between":
		if n.rawFlags&rawFlagBetween != 0 {
			return n.rawBetween, true
		}
	case "semicolon":
		if n.rawFlags&rawFlagSemicolon != 0 {
			return n.rawSemicolon, true
		}
	case "ownSemicolon":
		if n.rawFlags&rawFlagOwnSemicolon != 0 {
			return n.rawOwnSemicolon, true
		}
	case "afterName":
		if n.rawFlags&rawFlagAfterName != 0 {
			return n.rawAfterName, true
		}
	case "important":
		if n.rawFlags&rawFlagImportant != 0 {
			return n.rawImportant, true
		}
	case "left":
		if n.rawFlags&rawFlagLeft != 0 {
			return n.rawLeft, true
		}
	case "right":
		if n.rawFlags&rawFlagRight != 0 {
			return n.rawRight, true
		}
	case "indent":
		if n.rawFlags&rawFlagIndent != 0 {
			return n.rawIndent, true
		}
	case "selector":
		if n.rawFlags&rawFlagSelector != 0 {
			return n.rawSelector, true
		}
	case "value":
		if n.rawFlags&rawFlagValue != 0 {
			return n.rawValue, true
		}
	case "params":
		if n.rawFlags&rawFlagParams != 0 {
			return n.rawParams, true
		}
	}
	if n.Raws == nil {
		return nil, false
	}
	value, ok := n.Raws[key]
	if !ok || value == nil {
		return nil, false
	}
	return value, true
}

func (n *BaseNode) SetRawString(key, value string) {
	switch key {
	case "before":
		n.rawBefore = value
		n.rawFlags |= rawFlagBefore
	case "after":
		n.rawAfter = value
		n.rawFlags |= rawFlagAfter
	case "between":
		n.rawBetween = value
		n.rawFlags |= rawFlagBetween
	case "ownSemicolon":
		n.rawOwnSemicolon = value
		n.rawFlags |= rawFlagOwnSemicolon
	case "afterName":
		n.rawAfterName = value
		n.rawFlags |= rawFlagAfterName
	case "important":
		n.rawImportant = value
		n.rawFlags |= rawFlagImportant
	case "left":
		n.rawLeft = value
		n.rawFlags |= rawFlagLeft
	case "right":
		n.rawRight = value
		n.rawFlags |= rawFlagRight
	case "indent":
		n.rawIndent = value
		n.rawFlags |= rawFlagIndent
	default:
		n.ensureRaws()[key] = value
		return
	}
	if n.rawsMaterialized && n.Raws != nil {
		n.Raws[key] = value
	}
}

func (n *BaseNode) SetRawBool(key string, value bool) {
	if key != "semicolon" {
		n.ensureRaws()[key] = value
		return
	}
	n.rawSemicolon = value
	n.rawFlags |= rawFlagSemicolon
	if n.rawsMaterialized && n.Raws != nil {
		n.Raws[key] = value
	}
}

func (n *BaseNode) SetRawValue(key string, value RawValue) {
	switch key {
	case "selector":
		n.rawSelector = value
		n.rawFlags |= rawFlagSelector
	case "value":
		n.rawValue = value
		n.rawFlags |= rawFlagValue
	case "params":
		n.rawParams = value
		n.rawFlags |= rawFlagParams
	default:
		n.ensureRaws()[key] = value
		return
	}
	if n.rawsMaterialized && n.Raws != nil {
		n.Raws[key] = value
	}
}

func (n *BaseNode) DeleteRaw(key string) {
	switch key {
	case "before":
		n.rawFlags &^= rawFlagBefore
	case "after":
		n.rawFlags &^= rawFlagAfter
	case "between":
		n.rawFlags &^= rawFlagBetween
	case "semicolon":
		n.rawFlags &^= rawFlagSemicolon
	case "ownSemicolon":
		n.rawFlags &^= rawFlagOwnSemicolon
	case "afterName":
		n.rawFlags &^= rawFlagAfterName
	case "important":
		n.rawFlags &^= rawFlagImportant
	case "left":
		n.rawFlags &^= rawFlagLeft
	case "right":
		n.rawFlags &^= rawFlagRight
	case "indent":
		n.rawFlags &^= rawFlagIndent
	case "selector":
		n.rawFlags &^= rawFlagSelector
	case "value":
		n.rawFlags &^= rawFlagValue
	case "params":
		n.rawFlags &^= rawFlagParams
	}
	if n.Raws != nil {
		delete(n.Raws, key)
	}
}

func (n *BaseNode) ensureRaws() Raws {
	n.materializeRaws()
	if n.Raws == nil {
		n.Raws = make(Raws, 4)
	}
	return n.Raws
}

func (n *BaseNode) materializeRaws() {
	if n.rawsMaterialized {
		return
	}
	if n.rawFlags == 0 {
		n.rawsMaterialized = n.Raws != nil
		return
	}
	if n.Raws == nil {
		n.Raws = make(Raws, compactRawCount(n.rawFlags))
	}
	if n.rawFlags&rawFlagBefore != 0 {
		n.Raws["before"] = n.rawBefore
	}
	if n.rawFlags&rawFlagAfter != 0 {
		n.Raws["after"] = n.rawAfter
	}
	if n.rawFlags&rawFlagBetween != 0 {
		n.Raws["between"] = n.rawBetween
	}
	if n.rawFlags&rawFlagSemicolon != 0 {
		n.Raws["semicolon"] = n.rawSemicolon
	}
	if n.rawFlags&rawFlagOwnSemicolon != 0 {
		n.Raws["ownSemicolon"] = n.rawOwnSemicolon
	}
	if n.rawFlags&rawFlagAfterName != 0 {
		n.Raws["afterName"] = n.rawAfterName
	}
	if n.rawFlags&rawFlagImportant != 0 {
		n.Raws["important"] = n.rawImportant
	}
	if n.rawFlags&rawFlagLeft != 0 {
		n.Raws["left"] = n.rawLeft
	}
	if n.rawFlags&rawFlagRight != 0 {
		n.Raws["right"] = n.rawRight
	}
	if n.rawFlags&rawFlagIndent != 0 {
		n.Raws["indent"] = n.rawIndent
	}
	if n.rawFlags&rawFlagSelector != 0 {
		n.Raws["selector"] = n.rawSelector
	}
	if n.rawFlags&rawFlagValue != 0 {
		n.Raws["value"] = n.rawValue
	}
	if n.rawFlags&rawFlagParams != 0 {
		n.Raws["params"] = n.rawParams
	}
	n.rawsMaterialized = true
}

func compactRawCount(flags rawFlag) int {
	count := 0
	for bit := rawFlag(1); bit <= rawFlagIndent; bit <<= 1 {
		if flags&bit != 0 {
			count++
		}
	}
	return count
}

// SetRawString sets a string raw on any AST node.
func SetRawString(node Node, key, value string) {
	if base := baseNode(node); base != nil {
		base.SetRawString(key, value)
	}
}

// SetRawBool sets a boolean raw on any AST node.
func SetRawBool(node Node, key string, value bool) {
	if base := baseNode(node); base != nil {
		base.SetRawBool(key, value)
	}
}

// SetRawValue sets a RawValue raw on any AST node.
func SetRawValue(node Node, key string, value RawValue) {
	if base := baseNode(node); base != nil {
		base.SetRawValue(key, value)
	}
}

// DeleteRaw removes a formatting raw from any AST node.
func DeleteRaw(node Node, key string) {
	if base := baseNode(node); base != nil {
		base.DeleteRaw(key)
	}
}

func cloneBaseNode(source BaseNode) BaseNode {
	if source.rawsMaterialized || (source.rawFlags == 0 && source.Raws != nil) {
		return BaseNode{
			Raws:             CloneRaws(source.Raws),
			rawsMaterialized: source.Raws != nil,
		}
	}
	out := BaseNode{
		rawFlags:        source.rawFlags,
		rawSemicolon:    source.rawSemicolon,
		rawBefore:       source.rawBefore,
		rawAfter:        source.rawAfter,
		rawBetween:      source.rawBetween,
		rawOwnSemicolon: source.rawOwnSemicolon,
		rawAfterName:    source.rawAfterName,
		rawImportant:    source.rawImportant,
		rawLeft:         source.rawLeft,
		rawRight:        source.rawRight,
		rawIndent:       source.rawIndent,
		rawSelector:     source.rawSelector,
		rawValue:        source.rawValue,
		rawParams:       source.rawParams,
		Raws:            CloneRaws(source.Raws),
	}
	if source.Raws != nil {
		out.rawsMaterialized = true
	}
	return out
}
