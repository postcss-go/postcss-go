package ast

func Walk(node Node, fn func(Node) error) error {
	if err := fn(node); err != nil {
		return err
	}
	container, ok := node.(Container)
	if !ok {
		return nil
	}
	for _, child := range container.Children() {
		if err := Walk(child, fn); err != nil {
			return err
		}
	}
	return nil
}

func WalkRules(node Node, fn func(*Rule) error) error {
	return Walk(node, func(current Node) error {
		rule, ok := current.(*Rule)
		if !ok {
			return nil
		}
		return fn(rule)
	})
}

func WalkAtRules(node Node, fn func(*AtRule) error) error {
	return Walk(node, func(current Node) error {
		atRule, ok := current.(*AtRule)
		if !ok {
			return nil
		}
		return fn(atRule)
	})
}

func WalkDecls(node Node, fn func(*Declaration) error) error {
	return Walk(node, func(current Node) error {
		decl, ok := current.(*Declaration)
		if !ok {
			return nil
		}
		return fn(decl)
	})
}

func WalkComments(node Node, fn func(*Comment) error) error {
	return Walk(node, func(current Node) error {
		comment, ok := current.(*Comment)
		if !ok {
			return nil
		}
		return fn(comment)
	})
}
