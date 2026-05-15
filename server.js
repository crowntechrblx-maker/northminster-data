require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const { ApolloServer, gql } = require('apollo-server-express');

const app = express();
app.use(express.json());

// 1. CONNECTION
async function connectDB() {
    if (mongoose.connection.readyState >= 1) return;
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
}

// 2. MODELS
const Player = mongoose.models.Player || mongoose.model('Player', new mongoose.Schema({ roblox: String, cash: Number, created: String, account: { type: mongoose.Schema.Types.ObjectId, ref: 'BankAccount' }, license: { type: mongoose.Schema.Types.ObjectId, ref: 'License' }, properties: Array, vehicles: Array }));
const BankAccount = mongoose.models.BankAccount || mongoose.model('BankAccount', new mongoose.Schema({ balance: Number }));
const License = mongoose.models.License || mongoose.model('License', new mongoose.Schema({ hasTheory: Boolean, categories: Array, created: String }));
const Organisation = mongoose.models.Organisation || mongoose.model('Organisation', new mongoose.Schema({ name: String, groupId: String, created: String, discoverable: Boolean, type: String, tag: String, roleSet: Array, customPermissions: Array, bankAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'BankAccount' } }));

// 3. THE BULLETPROOF ID MAPPER
const format = (data) => {
    if (!data) return null;
    if (Array.isArray(data)) return data.map(format);
    
    // Convert Mongoose doc to plain object
    let obj = data.toObject ? data.toObject() : JSON.parse(JSON.stringify(data));
    
    // Map _id to id
    if (obj._id) obj.id = obj._id.toString();
    
    // Process nested objects (account, license, etc.)
    for (let key in obj) {
        if (obj[key] && typeof obj[key] === 'object' && key !== '_id') {
            obj[key] = format(obj[key]);
        }
    }
    return obj;
};

// 4. SCHEMA
const typeDefs = gql`
  scalar JSON
  type RoleSet { role: Int, salary: Int, permissions: [String] }
  type Account { id: String, balance: Int }
  type License { id: String, hasTheory: Boolean, categories: [JSON], created: String }
  type Organisation { id: String, name: String, groupId: String, created: String, discoverable: Boolean, type: String, tag: String, roleSet: [RoleSet], customPermissions: [JSON], bankAccount: Account }
  type Player { id: String, roblox: String, cash: Int, created: String, account: Account, license: License, properties: [JSON], vehicles: [JSON] }
  
  type Query {
    player(roblox: String, upsert: Boolean): Player
    organisation(id: String, name: String, group: String): Organisation
    organisations(groups: [String!]!): [Organisation]
  }
  type Mutation { updatePlayer(id: String!, cash: Int): Player }
`;

const resolvers = {
    Query: {
        player: async (_, { roblox, upsert }) => {
            await connectDB();
            let p = await Player.findOne({ roblox: String(roblox) });
            
            if (!p && upsert) {
                console.log("✨ Creating User...");
                const acc = await BankAccount.create({ balance: 1000 });
                const lic = await License.create({ hasTheory: false, categories: [], created: new Date().toISOString() });
                p = await Player.create({ roblox: String(roblox), cash: 500, created: new Date().toISOString(), account: acc._id, license: lic._id });
            }
            
            if (!p) return null;
            const full = await Player.findById(p._id).populate('account license');
            return format(full);
        },
        organisation: async (_, { id, name, group }) => {
            await connectDB();
            const q = id ? { _id: id } : (group ? { groupId: group } : { name: name });
            const org = await Organisation.findOne(q).populate('bankAccount');
            return format(org);
        },
        organisations: async (_, { groups }) => {
            await connectDB();
            const list = await Organisation.find({ groupId: { $in: groups } }).populate('bankAccount');
            return format(list);
        }
    },
    Mutation: {
        updatePlayer: async (_, { id, cash }) => {
            await connectDB();
            const p = await Player.findByIdAndUpdate(id, { cash }, { new: true });
            return format(p);
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