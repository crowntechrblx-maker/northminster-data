const { ApolloServer, gql } = require('apollo-server');
const mongoose = require('mongoose');

// Connect to your MongoDB from Step 1
mongoose.connect('YOUR_MONGODB_CONNECTION_STRING');

// Define the Data Structure (Matches your 'Documents' folder in Roblox)
const typeDefs = gql`
  type PlayerData {
    id: String
    location: String
    player: String
    account: String
    properties: [String]
  }

  type Query {
    getByRoblox(roblox: String): PlayerData
  }

  type Mutation {
    create(location: String, player: String): PlayerData
  }
`;

const resolvers = {
  Query: {
    getByRoblox: async (_, { roblox }) => {
      // Logic to find player in MongoDB
      // return await PlayerModel.findOne({ id: roblox });
    },
  },
};

const server = new ApolloServer({ 
    typeDefs, 
    resolvers,
    introspection: true // Allows Roblox to see the schema
});

server.listen({ port: process.env.PORT || 4000 }).then(({ url }) => {
  print(`🚀 Server ready at ${url}`);
});