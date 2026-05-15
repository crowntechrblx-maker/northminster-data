require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const { ApolloServer, gql } = require('apollo-server-express');

// 1. GLOBAL CONNECTION
let isConnected = false;
async function connectDB() {
    if (isConnected && mongoose.connection.readyState === 1) return;
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI; 
    try {
        await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
        isConnected = true;
        console.log("✅ MongoDB Connected");
    } catch (error) { console.error("❌ MongoDB Error:", error); }
}

const app = express();
app.use(express.json());

// 2. MONGOOSE MODELS (Full Schema)
const Player = mongoose.models.Player || mongoose.model('Player', new mongoose.Schema({
    roblox: { type: String, unique: true, required: true },
    created: { type: String, default: () => new Date().toISOString() },
    cash: { type: Number, default: 500 },
    inventory: { type: Array, default: [] },
    permissions: [{ name: String, source: String, canManage: Boolean }],
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'BankAccount' },
    license: { type: mongoose.Schema.Types.ObjectId, ref: 'License' },
    properties: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Property' }],
    vehicles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle' }]
}));

const BankAccount = mongoose.models.BankAccount || mongoose.model('BankAccount', new mongoose.Schema({ balance: { type: Number, default: 1000 } }));
const License = mongoose.models.License || mongoose.model('License', new mongoose.Schema({ created: String, suspendedUntil: String, hasTheory: { type: Boolean, default: false }, categories: [{ type: { type: String }, issued: String }] }));
const Organisation = mongoose.models.Organisation || mongoose.model('Organisation', new mongoose.Schema({ name: String, groupId: String, created: String, discoverable: Boolean, type: String, tag: String, customPermissions: [String], roleSet: [{ role: Number, salary: Number, permissions: [String] }], bankAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'BankAccount' } }));
const Vehicle = mongoose.models.Vehicle || mongoose.model('Vehicle', new mongoose.Schema({ created: String, numberPlate: String, colour: String, make: String, model: String, year: Number, inventory: [String], player: { type: mongoose.Schema.Types.ObjectId, ref: 'Player' }, property: { type: mongoose.Schema.Types.ObjectId, ref: 'Property' } }));
const Property = mongoose.models.Property || mongoose.model('Property', new mongoose.Schema({ created: String, location: String, active: Boolean, inventory: [String] }));

// 3. ID MAPPING HELPER
const mapId = (doc) => {
    if (!doc) return null;
    const obj = doc.toObject ? doc.toObject() : doc;
    obj.id = obj._id.toString();
    return obj;
};

// 4. FULL GRAPHQL SCHEMA (Matches your Roblox Queries 1:1)
const typeDefs = gql`
  scalar ObjectID
  scalar JSON

  type RoleSet { role: Int, salary: Int, permissions: [String] }
  type Permission { name: String, source: String, canManage: Boolean }
  type Account { id: ObjectID, balance: Int }
  type Category { type: String, issued: String }

  type License { 
    id: ObjectID, created: String, suspendedUntil: String, 
    hasTheory: Boolean, categories: [Category], endorsements: [String] 
  }

  type Organisation {
    id: ObjectID, name: String, groupId: String, created: String, 
    discoverable: Boolean, type: String, tag: String, 
    customPermissions: [String], roleSet: [RoleSet], bankAccount: Account
  }

  type Vehicle {
    id: ObjectID, created: String, numberPlate: String, colour: String, 
    make: String, model: String, year: Int, inventory: [String], 
    player: Player, property: Property
  }

  type Property { id: ObjectID, created: String, location: String, active: Boolean, inventory: [String] }

  type Player { 
    id: ObjectID, created: String, roblox: String, cash: Int, inventory: [JSON],
    account: Account, permissions: [Permission], license: License,
    properties: [Property], vehicles: [Vehicle]
  }

  type Query {
    player(roblox: String, upsert: Boolean): Player
    organisation(id: ObjectID, name: String, group: String): Organisation
    organisations(groups: [String!]!): [Organisation]
    bankAccount(id: ObjectID!): Account
    vehicle(id: ObjectID, numberPlate: String): Vehicle
    status: String
  }

  type Mutation {
    updatePlayer(id: ObjectID!, updatePlayerInput: UpdatePlayerInput!): Player
  }
  input UpdatePlayerInput { cash: Int, inventory: [String] }
`;

const resolvers = {
    Query: {
        player: async (_, { roblox, upsert }) => {
            await connectDB();
            let p = await Player.findOne({ roblox: String(roblox) });
            if (!p && upsert) {
                const acc = await BankAccount.create({});
                const lic = await License.create({ created: new Date().toISOString() });
                p = await Player.create({ roblox: String(roblox), account: acc._id, license: lic._id, created: new Date().toISOString() });
            }
            if (!p) return null;
            const data = await Player.findById(p._id).populate('account license properties vehicles');
            const res = mapId(data);
            if (res.account) res.account = mapId(res.account);
            if (res.license) res.license = mapId(res.license);
            res.properties = (res.properties || []).map(mapId);
            res.vehicles = (res.vehicles || []).map(mapId);
            return res;
        },
        organisation: async (_, { id, name, group }) => {
            await connectDB();
            const q = id ? { _id: id } : (group ? { groupId: group } : { name });
            const org = await Organisation.findOne(q).populate('bankAccount');
            if (!org) return null;
            const res = mapId(org);
            if (res.bankAccount) res.bankAccount = mapId(res.bankAccount);
            return res;
        },
        organisations: async (_, { groups }) => {
            await connectDB();
            const list = await Organisation.find({ groupId: { $in: groups } }).populate('bankAccount');
            return list.map(o => {
                const r = mapId(o);
                if (r.bankAccount) r.bankAccount = mapId(r.bankAccount);
                return r;
            });
        },
        bankAccount: async (_, { id }) => {
            await connectDB();
            return mapId(await BankAccount.findById(id));
        },
        status: () => "OK"
    },
    Mutation: {
        updatePlayer: async (_, { id, updatePlayerInput }) => {
            await connectDB();
            const p = await Player.findByIdAndUpdate(id, { $set: updatePlayerInput }, { new: true });
            return mapId(p);
        }
    }
};

// 5. ROUTES
app.all('/auth/token', (req, res) => res.json({ token: "authenticated_session", jobId: req.body.jobId }));
app.all(['/server/heartbeat', '/servers/heartbeat'], (req, res) => res.json({ success: true }));
app.get('/status', async (req, res) => { await connectDB(); res.send(`Database: ${mongoose.connection.readyState === 1 ? "CONNECTED" : "DISCONNECTED"}`); });
app.get('/', (req, res) => res.redirect('/status'));

// APOLLO STARTUP
const server = new ApolloServer({ typeDefs, resolvers, introspection: true, cache: "bounded" });
let started = false;
app.use(async (req, res, next) => {
    if (!started) { await server.start(); server.applyMiddleware({ app, path: '/graphql' }); started = true; }
    next();
});

module.exports = app;
if (process.env.NODE_ENV !== 'production') app.listen(4000);