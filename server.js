require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const { ApolloServer, gql } = require('apollo-server-express');

// 1. GLOBAL CONNECTION
let isConnected = false;
async function connectDB() {
    if (isConnected && mongoose.connection.readyState === 1) return;
    try {
        await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
        isConnected = true;
        console.log("✅ MongoDB Connected");
    } catch (error) { console.error("❌ MongoDB Error:", error); }
}

const app = express();
app.use(express.json());

// 2. MODELS
const Player = mongoose.models.Player || mongoose.model('Player', new mongoose.Schema({ roblox: String, cash: Number, inventory: Array, created: String, account: mongoose.Schema.Types.ObjectId, license: mongoose.Schema.Types.ObjectId, properties: Array, vehicles: Array }));
const BankAccount = mongoose.models.BankAccount || mongoose.model('BankAccount', new mongoose.Schema({ balance: Number }));
const License = mongoose.models.License || mongoose.model('License', new mongoose.Schema({ hasTheory: Boolean, categories: Array }));
const Organisation = mongoose.models.Organisation || mongoose.model('Organisation', new mongoose.Schema({ name: String, groupId: String, created: String, discoverable: Boolean, type: String, tag: String, roleSet: Array, customPermissions: Array, bankAccount: mongoose.Schema.Types.ObjectId }));

// 3. ID MAPPER (Ensures _id becomes id for Roblox)
const clean = (item) => {
    if (!item) return null;
    if (Array.isArray(item)) return item.map(clean);
    let obj = item.toObject ? item.toObject() : JSON.parse(JSON.stringify(item));
    if (obj._id) obj.id = obj._id.toString();
    return obj;
};

// 4. SCHEMA - MATCHING YOUR DOCUMENTS EXACTLY
const typeDefs = gql`
  scalar JSON
  scalar ObjectID

  input UpdatePlayerInput {
    cash: Int
    inventory: [JSON]
  }

  type RoleSet { role: Int, salary: Int, permissions: [String] }
  type Account { id: String, balance: Int }
  type License { id: String, hasTheory: Boolean, categories: [JSON], created: String, suspendedUntil: String }
  type Organisation { id: String, name: String, groupId: String, created: String, discoverable: Boolean, type: String, tag: String, roleSet: [RoleSet], bankAccount: Account }
  type Player { id: String, created: String, roblox: String, cash: Int, inventory: [JSON], account: Account, license: License, properties: [JSON], vehicles: [JSON] }
  
  type Query {
    player(id: ObjectID, roblox: String, upsert: Boolean): Player
    organisation(id: ObjectID, name: String, group: String): Organisation
    organisations(groups: [String!]!): [Organisation]
  }

  type Mutation {
    # This matches your update document: updatePlayer(id: $key, updatePlayerInput: $data)
    updatePlayer(id: ObjectID!, updatePlayerInput: UpdatePlayerInput!): Player
  }
`;

const resolvers = {
    Query: {
        player: async (_, { roblox, upsert }) => {
            await connectDB();
            let p = await Player.findOne({ roblox: String(roblox) });
            if (!p && upsert) {
                const acc = await BankAccount.create({ balance: 1000 });
                const lic = await License.create({ hasTheory: false, categories: [] });
                p = await Player.create({ roblox: String(roblox), account: acc._id, license: lic._id, cash: 500, created: new Date().toISOString() });
            }
            if (!p) return null;
            const data = await Player.findById(p._id).populate('account license').lean();
            let res = clean(data);
            if (res.account) res.account = clean(res.account);
            if (res.license) res.license = clean(res.license);
            return res;
        },
        organisation: async (_, { id, name, group }) => {
            await connectDB();
            const q = id ? { _id: id } : (group ? { groupId: group } : { name });
            const data = await Organisation.findOne(q).populate('bankAccount').lean();
            if (!data) return null;
            let res = clean(data);
            if (res.bankAccount) res.bankAccount = clean(res.bankAccount);
            return res;
        },
        organisations: async (_, { groups }) => {
            await connectDB();
            const list = await Organisation.find({ groupId: { $in: groups } }).populate('bankAccount').lean();
            return list.map(o => {
                let r = clean(o);
                if (r.bankAccount) r.bankAccount = clean(r.bankAccount);
                return r;
            });
        }
    },
    Mutation: {
        updatePlayer: async (_, { id, updatePlayerInput }) => {
            await connectDB();
            // Use findByIdAndUpdate to process the updatePlayerInput object
            const p = await Player.findByIdAndUpdate(
                id, 
                { $set: updatePlayerInput }, 
                { new: true }
            ).populate('account').lean();
            
            let res = clean(p);
            if (res.account) res.account = clean(res.account);
            return res;
        }
    }
};

const server = new ApolloServer({ typeDefs, resolvers, introspection: true, cache: "bounded" });
app.all('/auth/token', (req, res) => res.json({ token: "authenticated_session", jobId: req.body.jobId }));
app.all(['/server/heartbeat', '/servers/heartbeat'], (req, res) => res.json({ success: true }));
let started = false;
app.use(async (req, res, next) => {
    if (!started) { await server.start(); server.applyMiddleware({ app, path: '/graphql' }); started = true; }
    await connectDB();
    next();
});
module.exports = app;