import bodyParser from 'body-parser';
import { EventEmitter } from 'events';
import express from 'express';
import * as trpc from '@trpc/server';

let id = 0;

const ee = new EventEmitter();

const db = {
  posts: [
    {
      id: ++id,
      title: 'hello',
    },
  ],
  messages: [createMessage('initial message')],
};
async function getMessagesAfter(timestamp: number) {
  const msgs = db.messages.filter(
    (msg) => msg.updatedAt > timestamp || msg.createdAt > timestamp
  );

  return msgs;
}
function createMessage(text: string) {
  const msg = {
    id: ++id,
    text,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  ee.emit('newMessage', msg);
  return msg;
}

function createRouter() {
  return trpc.router<Context>();
}

const createContext = ({ req, res }: trpc.CreateExpressContextOptions) => {
  const getUser = () => {
    if (req.headers.authorization !== 'secret') {
      return null;
    }
    return {
      name: 'alex',
    };
  };

  return {
    req,
    res,
    user: getUser(),
  };
};
type Context = trpc.inferAsyncReturnType<typeof createContext>;

// create router for posts
const posts = createRouter()
  .mutations({
    create: (
      ctx,
      input: {
        title: string;
      }
    ) => {
      const post = {
        id: ++id,
        ...input,
      };
      db.posts.push(post);
      ctx.res.status(201);
      return post;
    },
  })
  .queries({
    list: () => db.posts,
  });

const messages = createRouter()
  .queries({
    list: () => db.messages,
  })
  .mutations({
    add: async (_ctx, text: string) => {
      const msg = createMessage(text);

      db.messages.push(msg);

      return msg;
    },
  })
  .subscriptions({
    newMessages: (_ctx, { timestamp }: { timestamp: number }) => {
      type Message = typeof db['messages'][number];

      return new trpc.Subscription<Message[]>({
        async getInitialData(emit) {
          const sinceLast = await getMessagesAfter(timestamp);
          if (sinceLast.length) {
            emit(sinceLast);
          }
        },
        start(emit) {
          const onMessage = (data: Message) => {
            emit([data]);
          };

          ee.on('newMessage', onMessage);
          return () => {
            ee.off('newMessage', onMessage);
          };
        },
      });
    },
  });

// root router to call
export const rootRouter = createRouter()
  .queries({
    hello: (ctx, input?: string) => {
      return `hello ${input ?? ctx.user?.name ?? 'world'}`;
    },
  })
  .merge('posts/', posts)
  .merge(
    'admin/',
    createRouter().queries({
      secret: (ctx) => {
        if (!ctx.user) {
          throw trpc.httpError.unauthorized();
        }
        if (ctx.user?.name !== 'alex') {
          throw trpc.httpError.forbidden();
        }
        return {
          secret: 'sauce',
        };
      },
    })
  )
  .merge('messages/', messages);

export type RootRouter = typeof rootRouter;

async function main() {
  const greeting = await rootRouter.invokeQuery({} as any)('hello', 'world');
  console.log(greeting);
  // message testing
  // {
  //   const subs = rootRouter.createSubscriptionHandler({} as any);
  //   const sub = await subs('messages/newMessages');
  //   setTimeout(() => {
  //     rootRouter.createMutationHandler({} as any)(
  //       'messages/add',
  //       'hello there',
  //     );
  //   }, 10);
  //   console.log('awaitng message');
  //   console.log('messages', await sub.onceDataAndStop());
  // }
  // express implementation
  const app = express();
  app.use(bodyParser.json());

  app.use((req, _res, next) => {
    // request logger
    console.log('⬅️ ', req.method, req.path, req.body ?? req.query);

    next();
  });

  app.use(
    '/trpc',
    trpc.createExpressMiddleware({
      router: rootRouter,
      createContext,
    })
  );
  app.listen(2021, () => {
    console.log('listening on port 2021');
  });
}

main();