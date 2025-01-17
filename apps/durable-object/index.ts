import { CloudflareDurableObjectSqliteSaver } from './cf-sqlite';
import { workflow } from './langgraph';
import { DurableObject } from 'cloudflare:workers';

interface Env {
  ExampleDurableObject: DurableObjectNamespace<ExampleDurableObject>;
}

interface SomeState {
  app?: any;
  checkpointer?: CloudflareDurableObjectSqliteSaver;
}

export class ExampleDurableObject extends DurableObject<Env> {
  static options = {
    // Hibernate the DO when it's not in use
    hibernate: true,
  };

  // create some internal state on the class
  internalState: SomeState = {
    app: undefined,
    checkpointer: undefined,
  };

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);

    this.internalState.checkpointer = new CloudflareDurableObjectSqliteSaver(this.ctx.storage.sql);
    this.internalState.app = workflow.compile({ checkpointer: this.internalState.checkpointer });
  }

  // requests via rpc are just functions
  async helloWorld(): Promise<string> {
    return 'hello world';
  }

  async runGraph(): Promise<string> {
    const messages = [
      { role: 'user', content: 'Hello, how can I help you today?' },
      {
        role: 'user',
        content: 'heyyyy',
      },
    ];
    try {
      console.log('running graph');
      console.log(this.internalState.app);
      const finalState = await this.internalState.app?.invoke(
        { messages },
        { configurable: { thread_id: '42' } }
      );
      console.log(finalState);
      return finalState.messages[finalState.messages.length - 1].content;
    } catch (error) {
      console.error(error);
      throw error;
    }
  }

  async getMessages(): Promise<string> {
    const messages = await this.internalState.checkpointer?.get({
      configurable: {
        thread_id: '42',
      },
    });
    console.log(messages);
    return JSON.stringify(messages);
  }
}

// TODO: add hono router here.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // assume the path is /durable-object/<id>/<endpoint>
    const path = url.pathname.split('/').filter(Boolean);

    if (path.length === 0) {
      return new Response('Hello from the worker durable-object');
    }

    if (path.length === 1 && path[0] === 'id') {
      return new Response(env.ExampleDurableObject.newUniqueId().toString());
    }

    const id = path[1] ?? env.ExampleDurableObject.newUniqueId();

    // /hello-world
    if (path.length === 3 && path[2] === 'hello') {
      const name = env.ExampleDurableObject.idFromName(id);
      const stub = env.ExampleDurableObject.get(name);
      const rpcResponse = await stub.helloWorld();

      return new Response(rpcResponse);
    }

    if (path.length === 3 && path[2] === 'graph') {
      const name = env.ExampleDurableObject.idFromName(id);
      const stub = env.ExampleDurableObject.get(name);
      const rpcResponse = await stub.runGraph();

      return new Response(rpcResponse);
    }

    if (path.length === 3 && path[2] === 'messages') {
      const name = env.ExampleDurableObject.idFromName(id);
      const stub = env.ExampleDurableObject.get(name);
      const rpcResponse = await stub.getMessages();

      return new Response(rpcResponse);
    }

    return new Response('Not Found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
