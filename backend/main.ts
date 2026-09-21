import {ApolloServer} from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import {resolvers} from './resolvers.ts';

const typedefs = await Deno.readTextFile('typedefs.graphql');

const server = new ApolloServer({

  typeDefs : typedefs,
  resolvers : resolvers

});

const {url} = await startStandaloneServer(server, {
  listen : { port : 3141 }
});

console.log(`server listening on ${url}`);
