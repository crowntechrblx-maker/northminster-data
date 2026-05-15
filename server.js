require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const { ApolloServer, gql } = require('apollo-server-express');

let isConnected = false;
async function connectDB() {
    if (isConnected && mongoose.connection.readyState === 1) return;
    try {
        await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
        isConnected = true;
        console.log("✅ MongoDB Connected");
    } catch (error) { console.error("❌ MongoDB Error:", error); }
}

const app = express();
app.use(express.json());

// --- MONGOOSE SCHEMAS (Defined exactly as Roblox expects) ---
const Player = mongoose.models.Player || mongoose.model('Player', new mongoose.Schema({ 
    roblox: String, cash: Number, created: String, 
    permissions: Array, inventory: Array,
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'BankAccount' }, 
    license: { type: mongoose.Schema.Types.ObjectId, ref: 'License' },
    properties: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Property' }],
    vehicles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle' }]
}));

const BankAccount = mongoose.models.BankAccount || mongoose.model('BankAccount', new mongoose.Schema({ balance: Number }));
const License = mongoose.models.License || mongoose.model('License', new mongoose.Schema({ created: String, suspendedUntil: String, hasTheory: Boolean, categories: Array, endorsements: Array }));
const Organisation = mongoose.models.Organisation || mongoose.model('Organisation', new mongoose.Schema({ name: String, groupId: String, created: String, discoverable: Boolean, type: String, tag: String, customPermissions: Array, roleSet: Array, bankAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'BankAccount' } }));
const Vehicle = mongoose.models.Vehicle || mongoose.model('Vehicle', new mongoose.Schema({ created: String, numberPlate: String, colour: String, make: String, model: String, year: Number, inventory: Array }));
const Property = mongoose.models.Property || mongoose.model('Property', new mongoose.Schema({ created: String, location: String, active: Boolean, inventory: Array }));

// ID MAPPER
const clean = (item) => {
    if (!item) return null;
    if (Array.isArray(item)) return item.map(clean);
    let obj = item.toObject ? item.toObject() : JSON.parse(JSON.stringify(item));
    if (obj._id) obj.id = obj._id.toString();
    return obj;
};

// --- GRAPHQL SCHEMA (The Mirror) ---
const typeDefs = gql`
  scalar JSON
  scalar ObjectID

  type RoleSet { role: Int, salary: Int, permissions: [String] }
  type Permission { name: String, source: String, canManage: Boolean }
  type Category { type: String, issued: String }
  type Account { id: String, balance: Int }

  type License { 
    id: String, created: String, suspendedUntil: String, 
    hasTheory: Boolean, categories: [Category], endorsements: [String] 
  }

  type Property { id: String, location: String, created: String, active: Boolean, inventory: [JSON] }
  
  type Vehicle { 
    id: String, created: String, numberPlate: String, colour: String, 
    make: String, model: String, year: Int, inventory: [JSON] 
  }

  type Organisation {
    id: String, name: String, groupId: String, created: String, 
    discoverable: Boolean, type: String, tag: String, 
    customPermissions: [JSON], roleSet: [RoleSet], bankAccount: Account
  }

  type Player { 
    id: String, roblox: String, cash: Int, created: String,
    permissions: [Permission], inventory: [JSON],
    account: Account, license: License, properties: [Property], vehicles: [Vehicle] 
  }

  type Query {
    player(roblox: String, upsert: Boolean): Player
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
                const acc = await BankAccount.create({ balance: 1000 });
                const lic = await License.create({ hasTheory: false, categories: [], created: new Date().toISOString() });
                p = await Player.create({ roblox: String(roblox), account: acc._id, license: lic._id, cash: 500, created: new Date().toISOString(), properties: [], vehicles: [] });
            }
            if (!p) return null;
            const data = await Player.findById(p._id).populate('account license properties vehicles').lean();
            let res = clean(data);
            if (res.account) res.account = clean(res.account);
            if (res.license) res.license = clean(res.license);
            res.properties = (res.properties || []).map(clean);
            res.vehicles = (res.vehicles || []).map(clean);
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