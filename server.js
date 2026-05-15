require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const { ApolloServer, gql } = require('apollo-server-express');

// 1. DATABASE CONNECTION
let isConnected = false;
async function connectDB() {
    if (isConnected && mongoose.connection.readyState === 1) return;
    try {
        await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, {
            serverSelectionTimeoutMS: 5000,
        });
        isConnected = true;
        console.log("✅ MongoDB Connected Successfully");
    } catch (error) {
        console.error("❌ MongoDB Connection Error:", error);
    }
}

const app = express();
app.use(express.json());

// 2. MODELS
const Player = mongoose.models.Player || mongoose.model('Player', new mongoose.Schema({ 
    roblox: { type: String, unique: true }, 
    cash: { type: Number, default: 500 }, 
    inventory: { type: Array, default: [] },
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'BankAccount' }, 
    license: { type: mongoose.Schema.Types.ObjectId, ref: 'License' },
    properties: { type: Array, default: [] },
    vehicles: { type: Array, default: [] }
}));

const BankAccount = mongoose.models.BankAccount || mongoose.model('BankAccount', new mongoose.Schema({ balance: { type: Number, default: 1000 } }));
const License = mongoose.models.License || mongoose.model('License', new mongoose.Schema({ hasTheory: { type: Boolean, default: false }, categories: { type: Array, default: [] } }));
const Organisation = mongoose.models.Organisation || mongoose.model('Organisation', new mongoose.Schema({ name: String, groupId: String, roleSet: Array }));

// 3. ID MAPPER (Forces _id to id)
const clean = (item) => {
    if (!item) return null;
    if (Array.isArray(item)) return item.map(clean);
    let obj = item.toObject ? item.toObject() : JSON.parse(JSON.stringify(item));
    if (obj._id) obj.id = obj._id.toString();
    return obj;
};

// 4. SCHEMA
const typeDefs = gql`
  scalar JSON
  scalar ObjectID
  type Account { id: String, balance: Int }
  type License { id: String, hasTheory: Boolean, categories: [JSON] }
  type Player { id: String, roblox: String, cash: Int, account: Account, license: License, properties: [JSON], vehicles: [JSON] }
  type Organisation { id: String, name: String, groupId: String, bankAccount: Account }
  
  type Query {
    player(roblox: String, upsert: Boolean): Player
    organisation(id: ObjectID, name: String, group: String): Organisation
    organisations(groups: [String!]!): [Organisation]
  }

  input UpdatePlayerInput { cash: Int, inventory: [JSON] }
  type Mutation {
    updatePlayer(id: ObjectID!, updatePlayerInput: UpdatePlayerInput!): Player
  }
`;

const resolvers = {
    Query: {
        player: async (_, { roblox, upsert }) => {
            await connectDB();
            const robloxId = String(roblox);
            console.log(`🔎 Querying player: ${robloxId} (Upsert: ${upsert})`);

            let p = await Player.findOne({ roblox: robloxId });

            if (!p && upsert) {
                console.log(`✨ Creating NEW user for: ${robloxId}`);
                try {
                    const acc = await BankAccount.create({ balance: 1000 });
                    const lic = await License.create({ hasTheory: false });
                    p = await Player.create({ 
                        roblox: robloxId, 
                        account: acc._id, 
                        license: lic._id,
                        cash: 500
                    });
                    console.log(`✅ User created: ${p._id}`);
                } catch (err) {
                    console.error("❌ User Creation Failed:", err);
                }
            }

            if (!p) return null;

            const data = await Player.findById(p._id).populate('account license').lean();
            let res = clean(data);
            if (res.account) res.account = clean(res.account);
            if (res.license) res.license = clean(res.license);
            
            console.log(`📦 Returning ID to Roblox: ${res.id}`);
            return res;
        },
        organisation: async (_, { id, name, group }) => {
            await connectDB();
            const q = id ? { _id: id } : (group ? { groupId: group } : { name });
            const data = await Organisation.findOne(q).lean();
            return clean(data);
        },
        organisations: async (_, { groups }) => {
            await connectDB();
            const list = await Organisation.find({ groupId: { $in: groups } }).lean();
            return list.map(clean);
        }
    },
    Mutation: {
        updatePlayer: async (_, { id, updatePlayerInput }) => {
            await connectDB();
            const p = await Player.findByIdAndUpdate(id, { $set: updatePlayerInput }, { new: true }).populate('account').lean();
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