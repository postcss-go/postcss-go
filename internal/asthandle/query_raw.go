package asthandle

import (
	"strings"

	"github.com/postcss-go/postcss-go/internal/ast"
)

var defaultRaw = map[string]any{
	"after":         "\n",
	"beforeClose":   "\n",
	"beforeComment": "\n",
	"beforeDecl":    "\n",
	"beforeOpen":    " ",
	"beforeRule":    "\n",
	"colon":         ": ",
	"commentLeft":   " ",
	"commentRight":  " ",
	"emptyBody":     "",
	"indent":        "    ",
	"semicolon":     false,
}

func inferRaw(node ast.Node, prop, defaultType string) any {
	detect := defaultType
	if detect == "" {
		detect = prop
	}
	return detectRaw(node, prop, detect)
}

func detectRaw(node ast.Node, own, detect string) any {
	if own != "" {
		if value, ok := rawValue(node, own); ok {
			return value
		}
	}
	parent := node.Parent()
	if detect == "before" {
		if parent == nil || parent.Type() == ast.NodeDocument || (parent.Type() == ast.NodeRoot && parent.First() == node) {
			return ""
		}
		return beforeAfter(node, "before")
	}
	if detect == "after" {
		return beforeAfter(node, "after")
	}

	root := node.Root()
	var found any
	switch detect {
	case "beforeOpen":
		walkRaw(root, func(candidate ast.Node) bool {
			if candidate.Type() != ast.NodeDecl {
				if value, ok := rawValue(candidate, "between"); ok {
					found = value
					return false
				}
			}
			return true
		})
	case "colon":
		walkRaw(root, func(candidate ast.Node) bool {
			if candidate.Type() == ast.NodeDecl {
				if value, ok := rawValue(candidate, "between"); ok {
					if text, ok := value.(string); ok {
						found = stripNonColonSpace(text)
						return false
					}
				}
			}
			return true
		})
	case "semicolon":
		walkRaw(root, func(candidate ast.Node) bool {
			container, ok := candidate.(ast.Container)
			if !ok || len(container.Children()) == 0 {
				return true
			}
			if container.Last() != nil && container.Last().Type() == ast.NodeDecl {
				if value, ok := rawValue(candidate, "semicolon"); ok {
					found = value
					return false
				}
			}
			return true
		})
	case "emptyBody":
		walkRaw(root, func(candidate ast.Node) bool {
			container, ok := candidate.(ast.Container)
			if !ok || len(container.Children()) != 0 {
				return true
			}
			if value, ok := rawValue(candidate, "after"); ok {
				found = value
				return false
			}
			return true
		})
	case "indent":
		if value, ok := rawValue(root, "indent"); ok {
			if text, ok := value.(string); ok {
				found = text
				break
			}
		}
		walkRaw(root, func(candidate ast.Node) bool {
			parentNode := candidate.Parent()
			if parentNode == nil || parentNode == root || parentNode.Parent() != root {
				return true
			}
			if value, ok := rawValue(candidate, "before"); ok {
				if text, ok := value.(string); ok {
					parts := strings.Split(text, "\n")
					found = stripNonSpace(parts[len(parts)-1])
					return false
				}
			}
			return true
		})
	case "beforeClose":
		walkRaw(root, func(candidate ast.Node) bool {
			container, ok := candidate.(ast.Container)
			if !ok || len(container.Children()) == 0 {
				return true
			}
			if value, ok := rawValue(candidate, "after"); ok {
				if text, ok := value.(string); ok {
					found = spacePrefix(text)
					return false
				}
			}
			return true
		})
	case "beforeDecl":
		walkRaw(root, func(candidate ast.Node) bool {
			if candidate.Type() != ast.NodeDecl {
				return true
			}
			if value, ok := rawValue(candidate, "before"); ok {
				if text, ok := value.(string); ok {
					found = spacePrefix(text)
					return false
				}
			}
			return true
		})
		if found == nil {
			return detectRaw(node, "", "beforeRule")
		}
	case "beforeComment":
		walkRaw(root, func(candidate ast.Node) bool {
			if candidate.Type() != ast.NodeComment {
				return true
			}
			if value, ok := rawValue(candidate, "before"); ok {
				if text, ok := value.(string); ok {
					found = spacePrefix(text)
					return false
				}
			}
			return true
		})
		if found == nil {
			return detectRaw(node, "", "beforeDecl")
		}
	case "beforeRule":
		rootContainer, _ := root.(ast.Container)
		walkRaw(root, func(candidate ast.Node) bool {
			container, ok := candidate.(ast.Container)
			if !ok || container.Children() == nil {
				return true
			}
			if rootContainer != nil && candidate.Parent() == root && rootContainer.First() == candidate {
				return true
			}
			if value, ok := rawValue(candidate, "before"); ok {
				if text, ok := value.(string); ok {
					found = spacePrefix(text)
					return false
				}
			}
			return true
		})
	default:
		if own != "" {
			walkRaw(root, func(candidate ast.Node) bool {
				if value, ok := rawValue(candidate, own); ok {
					found = value
					return false
				}
				return true
			})
		}
	}
	if found != nil {
		return found
	}
	if value, ok := defaultRaw[detect]; ok {
		return value
	}
	return ""
}

func beforeAfter(node ast.Node, detect string) string {
	var value string
	switch node.Type() {
	case ast.NodeDecl:
		value = stringifyRaw(detectRaw(node, "", "beforeDecl"))
	case ast.NodeComment:
		value = stringifyRaw(detectRaw(node, "", "beforeComment"))
	default:
		if detect == "before" {
			value = stringifyRaw(detectRaw(node, "", "beforeRule"))
		} else {
			value = stringifyRaw(detectRaw(node, "", "beforeClose"))
		}
	}
	depth := 0
	for parent := node.Parent(); parent != nil && parent.Type() != ast.NodeRoot && parent.Type() != ast.NodeDocument; parent = parent.Parent() {
		depth++
	}
	if strings.Contains(value, "\n") {
		indent := stringifyRaw(detectRaw(node, "", "indent"))
		if indent != "" {
			value += strings.Repeat(indent, depth)
		}
	}
	return value
}

func walkRaw(node ast.Node, visit func(ast.Node) bool) bool {
	container, ok := node.(ast.Container)
	if !ok {
		return true
	}
	for _, child := range container.Children() {
		if !visit(child) {
			return false
		}
		if !walkRaw(child, visit) {
			return false
		}
	}
	return true
}

func rawValue(node ast.Node, key string) (any, bool) {
	raws := node.RawFormattingReadOnly()
	if raws == nil {
		return nil, false
	}
	value, ok := raws[key]
	if !ok || value == nil {
		return nil, false
	}
	return value, true
}

func indentSample(text string) string {
	if strings.Contains(text, "\n") {
		return stripNonSpace(text[strings.LastIndexByte(text, '\n')+1:])
	}
	return stripNonSpace(text)
}

// spacePrefix matches PostCSS Node#raw(): keep trailing newlines, then drop non-space.
func spacePrefix(text string) string {
	if strings.Contains(text, "\n") {
		return keepWhitespace(text[:strings.LastIndexByte(text, '\n')+1])
	}
	return keepWhitespace(text)
}

func keepWhitespace(text string) string {
	return strings.Map(func(r rune) rune {
		switch r {
		case ' ', '\t', '\n', '\r', '\f', '\v':
			return r
		default:
			return -1
		}
	}, text)
}

func stripNonSpace(text string) string {
	return strings.Map(func(r rune) rune {
		if r == ' ' || r == '\t' {
			return r
		}
		return -1
	}, text)
}

func stripNonColonSpace(text string) string {
	return strings.Map(func(r rune) rune {
		if r == ' ' || r == '\t' || r == ':' {
			return r
		}
		return -1
	}, text)
}

func stringifyRaw(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	return ""
}
