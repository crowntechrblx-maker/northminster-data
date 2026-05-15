require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const { ApolloServer, gql } = require('apollo-server-express');

// 1. DATABASE CONNECTION
let isConnected = false;
async function connectDB() {
    if (isConnected && mongoose.connection.readyState === 1) return;
    try {
        await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
        isConnected = true;
    } catch (error) { console.error("❌ MongoDB Error:", error); }
}

const app = express();
app.use(express.json());

// 2. MODELS
const Player = mongoose.models.Player || mongoose.model('Player', new mongoose.Schema({ roblox: { type: String, unique: true }, cash: { type: Number, default: 500 }, inventory: Array, account: { type: mongoose.Schema.Types.ObjectId, ref: 'BankAccount' }, license: { type: mongoose.Schema.Types.ObjectId, ref: 'License' }, properties: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Property' }], vehicles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle' }] }));
const BankAccount = mongoose.models.BankAccount || mongoose.model('BankAccount', new mongoose.Schema({ balance: { type: Number, default: 1000 } }));
const License = mongoose.models.License || mongoose.model('License', new mongoose.Schema({ hasTheory: { type: Boolean, default: false }, categories: Array }));
const Organisation = mongoose.models.Organisation || mongoose.model('Organisation', new mongoose.Schema({ name: String, groupId: String, created: String, discoverable: Boolean, type: String, tag: String, roleSet: Array, customPermissions: Array, bankAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'BankAccount' } }));
const Vehicle = mongoose.models.Vehicle || mongoose.model('Vehicle', new mongoose.Schema({ numberPlate: String, model: String, colour: String, make: String, year: Number }));
const Property = mongoose.models.Property || mongoose.model('Property', new mongoose.Schema({ location: String }));

// 3. RECURSIVE ID MAPPER (The "Magic" Fix)
const clean = (item) => {
    if (!item) return null;
    if (Array.isArray(item)) return item.map(clean);
    let obj = item.toObject ? item.toObject() : JSON.parse(JSON.stringify(item));
    if (obj._id) obj.id = obj._id.toString();
    // Clean nested objects
    for (let key in obj) {
        if (typeof obj[key] === 'object') obj[key] = clean(obj[key]);
    }
    return obj;
};

// 4. FULL SCHEMA (Fixed ObjectID and Missing Fields)
const typeDefs = gql`
  scalar ObjectID
  scalar JSON

  type RoleSet { role: Int, salary: Int, permissions: [String] }
  type Account { id: String, balance: Int }
  type Category { type: String, issued: String }
  type License { id: String, hasTheory: Boolean, categories: [JSON], endorsements: [String], created: String, suspendedUntil: String }
  type Property { id: String, location: String, created: String, active: Boolean, inventory: [JSON] }
  type Vehicle { id: String, model: String, numberPlate: String, colour: String, make: String, year: Int, created: String, inventory: [JSON] }
  
  type Organisation {
    id: String, name: String, groupId: String, created: String, discoverable: Boolean, 
    type: String, tag: String, customPermissions: [String], roleSet: [RoleSet], bankAccount: Account
  }

  type Player { 
    id: String, roblox: String, cash: Int, inventory: [JSON],
    account: Account, license: License, properties: [Property], vehicles: [Vehicle] 
  }

  type Query {
    player(id: ObjectID, roblox: String, upsert: Boolean): Player
    organisation(id: ObjectID, name: String, group: String): Organisation
    organisations(groups: [String!]!): [Organisation]
  }

  type Mutation { updatePlayer(id: ObjectID!, cash: Int): Player }
`;

const resolvers = {
    Query: {
        player: async (_, { roblox, upsert }) => {
            await connectDB();
            let p = await Player.findOne({ roblox: String(roblox) });
            if (!p && upsert) {
                const acc = await BankAccount.create({});
                const lic = await License.create({});
                p = await Player.create({ roblox: String(roblox), account: acc._id, license: lic._id });
            }
            if (!p) return null;
            return clean(await Player.findById(p._id).populate('account license properties vehicles'));
        },
        organisation: async (_, { id, name, group }) => {
            await connectDB();
            const q = id ? { _id: id } : (group ? { groupId: group } : { name });
            return clean(await Organisation.findOne(q).populate('bankAccount'));
        },
        organisations: async (_, { groups }) => {
            await connectDB();
            const list = await Organisation.find({ groupId: { $in: groups } }).populate('bankAccount');
            return clean(list);
        }
    },
    Mutation: {
        updatePlayer: async (_, { id, cash }) => {
            await connectDB();
            return clean(await Player.findByIdAndUpdate(id, { cash }, { new: true }));
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