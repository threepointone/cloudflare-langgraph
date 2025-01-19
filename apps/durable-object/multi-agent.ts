import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { StructuredTool } from "@langchain/core/tools";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import { Runnable } from "@langchain/core/runnables";
import { ChatOpenAI } from "@langchain/openai";
import type { Server } from "partyserver";

/**
 * Create an agent that can run a set of tools.
 */
async function createAgent({
  llm,
  tools,
  systemMessage,
}: {
  llm: ChatOpenAI;
  tools: StructuredTool[];
  systemMessage: string;
}): Promise<Runnable> {
  const toolNames = tools.map((tool) => tool.name).join(", ");
  const formattedTools = tools.map((t) => convertToOpenAITool(t));

  let prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      "You are a helpful AI assistant, collaborating with other assistants." +
        " Use the provided tools to progress towards answering the question." +
        " If you are unable to fully answer, that's OK, another assistant with different tools " +
        " will help where you left off. Execute what you can to make progress." +
        " If you or any of the other assistants have the final answer or deliverable," +
        " prefix your response with FINAL ANSWER so the team knows to stop." +
        " You have access to the following tools: {tool_names}.\n{system_message}",
    ],
    new MessagesPlaceholder("messages"),
  ]);
  prompt = await prompt.partial({
    system_message: systemMessage,
    tool_names: toolNames,
  });

  return prompt.pipe(llm.bind({ tools: formattedTools }));
}

import { BaseMessage } from "@langchain/core/messages";
import { Annotation } from "@langchain/langgraph";

// This defines the object that is passed between each node
// in the graph. We will create different nodes for each agent and tool
const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
  }),
  sender: Annotation<string>({
    reducer: (x, y) => y ?? x ?? "user",
    default: () => "user",
  }),
});

import { TavilySearchResults } from "@langchain/community/tools/tavily_search";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const chartTool = tool(
  ({ data }) => {
    try {
      console.log("chart", data);
      const ctx = context.getStore();
      (ctx as any).do.broadcast(JSON.stringify({ type: "chart", data }));
    } catch (e) {
      console.error(e);
    }
  },
  {
    name: "generate_bar_chart",
    description:
      "Generates a bar chart from an array of data points using D3.js and displays it for the user.",
    schema: z.object({
      data: z
        .object({
          label: z.string(),
          value: z.number(),
        })
        .array(),
    }),
  }
);

const tavilyTool = new TavilySearchResults({
  apiKey: process.env.TAVILY_API_KEY,
});

import { HumanMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";

// Helper function to run a node for a given agent
async function runAgentNode(props: {
  state: typeof AgentState.State;
  agent: Runnable;
  name: string;
  config?: RunnableConfig;
}) {
  const { state, agent, name, config } = props;
  let result = await agent.invoke(state, config);
  // We convert the agent output into a format that is suitable
  // to append to the global state
  if (!result?.tool_calls || result.tool_calls.length === 0) {
    // If the agent is NOT calling a tool, we want it to
    // look like a human message.
    result = new HumanMessage({ ...result, name: name });
  }
  return {
    messages: [result],
    // Since we have a strict workflow, we can
    // track the sender so we know who to pass to next.
    sender: name,
  };
}

const llm = new ChatOpenAI({
  modelName: "gpt-4o",
  apiKey: process.env.OPENAI_API_KEY,
});

// Research agent and node
const researchAgent = await createAgent({
  llm,
  tools: [tavilyTool],
  systemMessage:
    "You should provide accurate data for the chart generator to use.",
});

async function researchNode(
  state: typeof AgentState.State,
  config?: RunnableConfig
) {
  return runAgentNode({
    state: state,
    agent: researchAgent,
    name: "Researcher",
    config,
  });
}

// Chart Generator
const chartAgent = await createAgent({
  llm,
  tools: [chartTool],
  systemMessage: "Any charts you display will be visible by the user.",
});

async function chartNode(state: typeof AgentState.State) {
  return runAgentNode({
    state: state,
    agent: chartAgent,
    name: "ChartGenerator",
  });
}

import { ToolNode } from "@langchain/langgraph/prebuilt";

const tools = [tavilyTool, chartTool];
// This runs tools in the graph
const toolNode = new ToolNode<typeof AgentState.State>(tools);

import { AIMessage } from "@langchain/core/messages";
// Either agent can decide to end
function router(state: typeof AgentState.State) {
  const messages = state.messages;
  const lastMessage = messages[messages.length - 1] as AIMessage;
  if (lastMessage?.tool_calls && lastMessage.tool_calls.length > 0) {
    // The previous agent is invoking a tool
    return "call_tool";
  }
  if (
    typeof lastMessage.content === "string" &&
    lastMessage.content.includes("FINAL ANSWER")
  ) {
    // Any agent decided the work is done
    return "end";
  }
  return "continue";
}

import { END, START, StateGraph } from "@langchain/langgraph";
import { context } from "./context";

// 1. Create the graph
const workflow = new StateGraph(AgentState)
  // 2. Add the nodes; these will do the work
  .addNode("Researcher", researchNode)
  .addNode("ChartGenerator", chartNode)
  .addNode("call_tool", toolNode);

// 3. Define the edges. We will define both regular and conditional ones
// After a worker completes, report to supervisor
workflow.addConditionalEdges("Researcher", router, {
  // We will transition to the other agent
  continue: "ChartGenerator",
  call_tool: "call_tool",
  end: END,
});

workflow.addConditionalEdges("ChartGenerator", router, {
  // We will transition to the other agent
  continue: "Researcher",
  call_tool: "call_tool",
  end: END,
});

workflow.addConditionalEdges(
  "call_tool",
  // Each agent node updates the 'sender' field
  // the tool calling node does not, meaning
  // this edge will route back to the original agent
  // who invoked the tool
  (x) => x.sender,
  {
    Researcher: "Researcher",
    ChartGenerator: "ChartGenerator",
  }
);

workflow.addEdge(START, "Researcher");

export { workflow };
