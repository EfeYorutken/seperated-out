import {ApolloServer} from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import {resolvers} from './resolvers.ts';

import { init_db } from "./db_stuff.ts";
import { start_scheduler } from './scheduler.ts';

const typedefs = await Deno.readTextFile('typedefs.graphql');

const server = new ApolloServer({

  typeDefs : typedefs,
  resolvers : resolvers

});

const {url} = await startStandaloneServer(server, {
  listen : { port : 3141 }
});

console.log(`server listening on ${url}`);

//importing resolvers.ts already connected the db, so this only re-checks it
if(await init_db()){
  start_scheduler();
}
else{
  console.error('[SCHEDULER] not started, no database connection');
}
