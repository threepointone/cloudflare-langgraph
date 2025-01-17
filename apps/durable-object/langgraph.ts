import { Annotation, StateGraph } from '@langchain/langgraph';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

// Define the graph state
// See here for more info: https://langchain-ai.github.io/langgraphjs/how-tos/define-state/
const StateAnnotation = Annotation.Root({
  messages: Annotation<Message[]>,
});

// Define the function that calls the model
async function callModel(state: typeof StateAnnotation.State) {
  const messages = state.messages;
  return {
    messages: [...messages, { role: 'assistant', content: 'Hello, how can I help you today?' }],
  };
}

// Define a new graph
export const workflow = new StateGraph(StateAnnotation)
  .addNode('agent', callModel)
  .addEdge('__start__', 'agent')
  .addEdge('agent', '__end__');
