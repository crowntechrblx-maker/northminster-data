require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const { ApolloServer, gql } = require('apollo-server-express');

// --- DATABASE CONNECTION ---
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

// --- MONGOOSE MODELS (Covering ALL your documents) ---
const Player = mongoose.models.Player || mongoose.model('Player', new mongoose.Schema({ roblox: String, cash: Number, created: String, inventory: Array, permissions: Array, account: { type: mongoose.Schema.Types.ObjectId, ref: 'BankAccount' }, license: { type: mongoose.Schema.Types.ObjectId, ref: 'License' }, properties: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Property' }], vehicles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle' }] }));
const BankAccount = mongoose.models.BankAccount || mongoose.model('BankAccount', new mongoose.Schema({ balance: Number, player: { type: mongoose.Schema.Types.ObjectId, ref: 'Player' }, organisation: { type: mongoose.Schema.Types.ObjectId, ref: 'Organisation' } }));
const License = mongoose.models.License || mongoose.model('License', new mongoose.Schema({ hasTheory: Boolean, categories: Array, created: String, suspendedUntil: String, endorsements: Array }));
const Organisation = mongoose.models.Organisation || mongoose.model('Organisation', new mongoose.Schema({ name: String, groupId: String, created: String, discoverable: Boolean, type: String, tag: String, roleSet: Array, customPermissions: Array, bankAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'BankAccount' } }));
const Vehicle = mongoose.models.Vehicle || mongoose.model('Vehicle', new mongoose.Schema({ numberPlate: String, model: String, colour: String, make: String, year: Number, inventory: Array, player: { type: mongoose.Schema.Types.ObjectId, ref: 'Player' }, property: { type: mongoose.Schema.Types.ObjectId, ref: 'Property' } }));
const Property = mongoose.models.Property || mongoose.model('Property', new mongoose.Schema({ location: String, active: Boolean, inventory: Array, player: { type: mongoose.Schema.Types.ObjectId, ref: 'Player' } }));
const Record = mongoose.models.Record || mongoose.model('Record', new mongoose.Schema({ type: String, created: String, issuer: { type: mongoose.Schema.Types.ObjectId, ref: 'Player' }, subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Player' }, charges: Array }));

// --- THE RECURSIVE ID MAPPER (The Bridge) ---
const clean = (item) => {
    if (!item) return null;
    if (Array.isArray(item)) return item.map(clean);
    let obj = item.toObject ? item.toObject() : JSON.parse(JSON.stringify(item));
    if (obj._id) obj.id = obj._id.toString();
    for (let key in obj) {
        if (obj[key] && typeof obj[key] === 'object' && key !== '_id') {
            obj[key] = clean(obj[key]);
        }
    }
    return obj;
};

// --- GRAPHQL SCHEMA (Matching your Documents 1:1) ---
const typeDefs = gql`
  scalar JSON
  type RoleSet { role: Int, salary: Int, permissions: [String] }
  type Permission { name: String, source: String, canManage: Boolean }
  type Category { type: String, issued: String }
  type Account { id: String, balance: Int, player: Player, organisation: Organisation }
  type License { id: String, hasTheory: Boolean, categories: [Category], created: String, suspendedUntil: String, endorsements: [String] }
  type Property { id: String, location: String, created: String, active: Boolean, inventory: [JSON], player: Player }
  type Vehicle { id: String, model: String, numberPlate: String, colour: String, make: String, year: Int, created: String, inventory: [JSON], player: Player, property: Property }
  type Organisation { id: String, name: String, groupId: String, created: String, discoverable: Boolean, type: String, tag: String, customPermissions: [JSON], roleSet: [RoleSet], bankAccount: Account }
  type Player { id: String, roblox: String, cash: Int, created: String, permissions: [Permission], inventory: [JSON], account: Account, license: License, properties: [Property], vehicles: [Vehicle] }
  type Record { id: String, type: String, created: String, issuer: Player, subject: Player, charges: [JSON] }

  type Query {
    player(roblox: String, id: String, upsert: Boolean): Player
    players(id: String): [Player]
    organisation(id: String, name: String, group: String): Organisation
    organisations(groups: [String!]!): [Organisation]
    bankAccount(id: String!): Account
    vehicle(id: String, numberPlate: String): Vehicle
    vehicles(player: String, org: String, property: String, take: Int, skip: Int): VehicleConnection
    property(id: String!): Property
    records(subject: String, type: String, take: Int, skip: Int): RecordConnection
  }

  type VehicleConnection { vehicles: [Vehicle], total: Int }
  type RecordConnection { records: [Record], total: Int }

  type Mutation {
    updatePlayer(id: String!, updatePlayerInput: UpdatePlayerInput!): Player
    createOrganisation(input: JSON!): Organisation
    createVehicle(input: JSON!): Vehicle
    createProperty(input: JSON!): Property
    createRecord(input: JSON!): Record
  }
  input UpdatePlayerInput { cash: Int, inventory: [JSON] }
`;

const resolvers = {
    Query: {
        player: async (_, { roblox, id, upsert }) => {
            await connectDB();
            let p = id ? await Player.findById(id) : await Player.findOne({ roblox: String(roblox) });
            if (!p && upsert) {
                const acc = await BankAccount.create({ balance: 1000 });
                const lic = await License.create({ hasTheory: false, categories: [], created: new Date().toISOString() });
                p = await Player.create({ roblox: String(roblox), account: acc._id, license: lic._id, cash: 500, created: new Date().toISOString(), properties: [], vehicles: [] });
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
            return clean(await Organisation.find({ groupId: { $in: groups } }).populate('bankAccount'));
        },
        bankAccount: async (_, { id }) => {
            await connectDB();
            return clean(await BankAccount.findById(id).populate('player organisation'));
        },
        vehicle: async (_, { id, numberPlate }) => {
            await connectDB();
            return clean(await Vehicle.findOne(id ? { _id: id } : { numberPlate }).populate('player property'));
        }
    },
    Mutation: {
        updatePlayer: async (_, { id, updatePlayerInput }) => {
            await connectDB();
            return clean(await Player.findByIdAndUpdate(id, { $set: updatePlayerInput }, { new: true }).populate('account license'));
        }
    }
};

// --- APOLLO & ROUTES ---
const server = new ApolloServer({ typeDefs, resolvers, introspection: true, cache: "bounded" });
app.all('/auth/token', (req, res) => res.json({ token: "authenticated_session", jobId: req.body.jobId }));
app.all(['/server/heartbeat', '/servers/heartbeat'], (req, res) => res.json({ success: true }));
app.get('/status', async (req, res) => { await connectDB(); res.send(`Database: ${mongoose.connection.readyState === 1 ? "CONNECTED" : "DISCONNECTED"}`); });

let started = false;
app.use(async (req, res, next) => {
    if (!started) { await server.start(); server.applyMiddleware({ app, path: '/graphql' }); started = true; }
    await connectDB();
    next();
});

module.exports = app;