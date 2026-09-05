package stringifier

import (
	"strings"

	"github.com/postcss-go/postcss-go/internal/ast"
)

// directEligible reports whether the tree can be stringified without
// sibling/document inference. Parsed stylesheets from the Go parser satisfy
// this when every formatting raw is explicit; otherwise the general stringifier
// path runs.
func directEligible(node ast.Node) bool {
	switch current := node.(type) {
	case *ast.Document:
		for index, child := range current.Nodes {
			if !directEligibleChild(child, 0, index) {
				return false
			}
		}
	case *ast.Root:
		for index, child := range current.Nodes {
			if !directEligibleChild(child, 0, index) {
				return false
			}
		}
	default:
		return false
	}
	return true
}

func directEligibleChild(node ast.Node, depth, index int) bool {
	if !directBeforeEligible(node, depth, index) {
		return false
	}
	switch current := node.(type) {
	case *ast.Rule:
		if !directBlockEligible(current) {
			return false
		}
		for childIndex, child := range current.Nodes {
			if !directEligibleChild(child, depth+1, childIndex) {
				return false
			}
		}
	case *ast.AtRule:
		if current.Block {
			if !directBlockEligible(current) {
				return false
			}
			if !ast.HasRaw(current, "between") {
				return false
			}
			for childIndex, child := range current.Nodes {
				if !directEligibleChild(child, depth+1, childIndex) {
					return false
				}
			}
		} else if !directBetweenEligible(current) {
			return false
		}
	case *ast.Declaration:
		if !directBetweenEligible(current) {
			return false
		}
	case *ast.Comment:
		if !directCommentEligible(current) {
			return false
		}
	default:
		return false
	}
	return true
}

func directBeforeEligible(node ast.Node, depth, index int) bool {
	if ast.HasRaw(node, "before") {
		return true
	}
	if rule, ok := node.(*ast.Rule); ok && rule.Selector == "from" {
		return true
	}
	if index == 0 && depth == 0 {
		return true
	}
	if parent := node.Parent(); parent != nil {
		if atRule, ok := parent.(*ast.AtRule); ok && atRule.Name == "keyframes" && index == 0 && node.Source() == nil {
			return true
		}
	}
	return false
}

func directBlockEligible(node ast.Container) bool {
	return ast.HasRaw(node, "after")
}

func directBetweenEligible(node ast.Node) bool {
	if !ast.HasRaw(node, "between") {
		return node.Type() != ast.NodeDecl
	}
	if node.Type() == ast.NodeDecl {
		if text, ok := ast.LookupRawString(node, "between"); ok && text == "" {
			return false
		}
	}
	return true
}

func directCommentEligible(node *ast.Comment) bool {
	return ast.HasRaw(node, "left") && ast.HasRaw(node, "right")
}

func directStringify(node ast.Node, stripSourceMapAnnotations bool) string {
	var builder strings.Builder
	if rng := node.Range(); rng.End > rng.Start {
		builder.Grow(rng.End - rng.Start + 64)
	}
	directWriteNode(builderWriter{Builder: &builder, cache: nil}, node, 0, stripSourceMapAnnotations)
	return builder.String()
}

func directWriteEscaped(writer cssWriter, value string) {
	writer.writeString(escapeHTMLInCSS(value))
}

func directWriteRuleHeader(writer cssWriter, node *ast.Rule) {
	directWriteEscaped(writer, rawValue(node, "selector", strings.TrimSpace(node.Selector)))
	directWriteEscaped(writer, rawString(node, "between", " "))
}

func directWriteDeclaration(writer cssWriter, node *ast.Declaration) {
	directWriteEscaped(writer, strings.TrimSpace(node.Prop))
	directWriteEscaped(writer, rawString(node, "between", ": "))
	value := node.Value
	if !strings.HasPrefix(node.Prop, "--") {
		value = strings.TrimSpace(value)
	}
	directWriteEscaped(writer, rawValue(node, "value", value))
	if node.Important {
		directWriteEscaped(writer, rawString(node, "important", " !important"))
	}
}

func directWriteComment(writer cssWriter, node *ast.Comment) {
	writer.writeString("/*")
	directWriteEscaped(writer, rawString(node, "left", " "))
	directWriteEscaped(writer, node.Text)
	directWriteEscaped(writer, rawString(node, "right", " "))
	writer.writeString("*/")
}

func directWriteNode(writer cssWriter, node ast.Node, depth int, stripSourceMapAnnotations bool) {
	switch current := node.(type) {
	case *ast.Document:
		directWriteChildren(writer, current.Nodes, depth, false, stripSourceMapAnnotations)
		writer.writeString(rawString(current, "after", ""))
	case *ast.Root:
		writer.writeString(rootBOM(current))
		directWriteChildren(writer, current.Nodes, depth, true, stripSourceMapAnnotations)
		writer.writeString(rawString(current, "after", ""))
	case *ast.Rule:
		directWriteRuleHeader(writer, current)
		writer.writeByte('{')
		childCount := directWriteChildren(writer, current.Nodes, depth+1, true, stripSourceMapAnnotations)
		directWriteBlockClose(writer, current, childCount)
		writer.writeString(rawString(current, "ownSemicolon", ""))
	case *ast.AtRule:
		writer.writeString(atRuleHeader(current))
		if !current.Block {
			writer.writeString(rawString(current, "between", ""))
			if atRuleHasSemicolon(current) {
				writer.writeByte(';')
			}
			return
		}
		writer.writeString(rawString(current, "between", ""))
		writer.writeByte('{')
		childCount := directWriteChildren(writer, current.Nodes, depth+1, true, stripSourceMapAnnotations)
		directWriteBlockClose(writer, current, childCount)
	case *ast.Declaration:
		directWriteDeclaration(writer, current)
		if parent := current.Parent(); parent != nil && needsSemicolon(parent, current) {
			writer.writeByte(';')
		}
	case *ast.Comment:
		directWriteComment(writer, current)
	}
}

func directWriteChildren(writer cssWriter, nodes []ast.Node, depth int, escape bool, stripSourceMapAnnotations bool) int {
	written := 0
	for index, child := range nodes {
		if stripSourceMapAnnotations && isSourceMapAnnotationNode(child) {
			continue
		}
		before := directNodeBefore(child, depth, index)
		if escape {
			writer.writeString(escapeHTMLInCSS(before))
		} else {
			writer.writeString(before)
		}
		directWriteNode(writer, child, depth, stripSourceMapAnnotations)
		written++
	}
	return written
}

func directNodeBefore(node ast.Node, depth, index int) string {
	if text, ok := ast.LookupRawString(node, "before"); ok {
		return text
	}
	if rule, ok := node.(*ast.Rule); ok && rule.Selector == "from" {
		return ""
	}
	if index == 0 && depth == 0 {
		return ""
	}
	if parent := node.Parent(); parent != nil {
		if atRule, ok := parent.(*ast.AtRule); ok && atRule.Name == "keyframes" && index == 0 && node.Source() == nil {
			return ""
		}
	}
	return ""
}

func directWriteBlockClose(writer cssWriter, node ast.Node, childCount int) {
	writer.writeString(escapeHTMLInCSS(rawString(node, "after", "")))
	writer.writeByte('}')
}
