import path from 'node:path';
import { DepGraph } from 'dependency-graph';

export interface DependencyMessage {
  type: 'dependency';
  parent: string;
  file: string;
}

export interface DirDependencyMessage {
  type: 'dir-dependency';
  parent: string;
  dir: string;
  glob?: string;
}

export type GraphMessage = DependencyMessage | DirDependencyMessage;

export interface DependencyGraph {
  add(message: GraphMessage): GraphMessage;
  dependantsOf(node: string): string[];
}

export default function createDependencyGraph(): DependencyGraph {
  const graph = new DepGraph();
  return {
    add(message) {
      message.parent = path.resolve(message.parent);
      graph.addNode(message.parent);

      if (message.type === 'dir-dependency') {
        message.dir = path.resolve(message.dir);
        graph.addNode(message.dir);
        graph.addDependency(message.parent, message.dir);
      } else {
        message.file = path.resolve(message.file);
        graph.addNode(message.file);
        graph.addDependency(message.parent, message.file);
      }

      return message;
    },
    dependantsOf(node) {
      node = path.resolve(node);

      if (graph.hasNode(node)) return graph.dependantsOf(node);
      return [];
    },
  };
}
