const { ApolloServer, gql } = require('apollo-server');
const mongoose = require('mongoose');

// 1. Connect to MongoDB
// Replace this with your actual connection string from MongoDB Atlas
const MONGO_URI = 'mongodb+srv://<username>:<password>@cluster.mongodb.net/myGame?retryWrites=true&w=majority';

mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("Connected to MongoDB"))
  .catch(err => console.error("Could not connect to MongoDB", err));

// 2. Define the Schema (How data looks in the DB)
const PlayerSchema = new mongoose.Schema({
  robloxId: String,
  location: String,
  player: String,
  account: String,
  properties: [String]
});

const PlayerModel = mongoose.model('Player', PlayerSchema);

// 3. GraphQL Definitions
const typeDefs = gql`
  type PlayerData {
    robloxId: String
    location: String
    player: String
    account: String
    properties: [String]
  }

  type Query {
    getByRoblox(robloxId: String!): PlayerData
  }

  type Mutation {
    createPlayer(robloxId: String!, location: String!): PlayerData
  }
`;

// 4. Resolvers (The logic)
const resolvers = {
  Query: {
    getByRoblox: async (_, { robloxId }) => {
      return await PlayerModel.findOne({ robloxId: robloxId });
    },
  },
  Mutation: {
    createPlayer: async (_, { robloxId, location }) => {
      const newPlayer = new PlayerModel({ robloxId, location });
      return await newPlayer.save();
    }
  }
};

const server = new ApolloServer({ 
    typeDefs, 
    resolvers,
    introspection: true 
});

server.listen({ port: process.env.PORT || 4000 }).then(({ url }) => {
  console.log(`🚀 Server ready at ${url}`);
});