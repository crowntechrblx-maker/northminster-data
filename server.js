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

// MODELS
const playerSchema = new mongoose.Schema({ roblox: { type: String, unique: true }, cash: { type: Number, default: 500 }, account: { type: mongoose.Schema.Types.ObjectId, ref: 'BankAccount' }, license: { type: mongoose.Schema.Types.ObjectId, ref: 'License' }, properties: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Property' }], vehicles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle' }] });
const Player = mongoose.models.Player || mongoose.model('Player', playerSchema);
const BankAccount = mongoose.models.BankAccount || mongoose.model('BankAccount', new mongoose.Schema({ balance: { type: Number, default: 1000 } }));
const License = mongoose.models.License || mongoose.model('License', new mongoose.Schema({ hasTheory: { type: Boolean, default: false }, categories: Array }));
const Organisation = mongoose.models.Organisation || mongoose.model('Organisation', new mongoose.Schema({ name: String, groupId: String, discoverable: Boolean, bankAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'BankAccount' } }));
const Vehicle = mongoose.models.Vehicle || mongoose.model('Vehicle', new mongoose.Schema({ numberPlate: String, model: String }));
const Property = mongoose.models.Property || mongoose.model('Property', new mongoose.Schema({ location: String }));

// DEEP CLEANER: Forces all _id into id strings
const clean = (item) => {
    if (!item) return null;
    let obj = item.toObject ? item.toObject() : JSON.parse(JSON.stringify(item));
    if (obj._id) obj.id = obj._id.toString();
    return obj;
};

const typeDefs = gql`
  scalar JSON
  type Account { id: String, balance: Int }
  type License { id: String, hasTheory: Boolean, categories: [JSON] }
  type Player { id: String, roblox: String, cash: Int, account: Account, license: License, properties: [Property], vehicles: [Vehicle] }
  type Organisation { id: String, name: String, groupId: String, bankAccount: Account }
  type Property { id: String, location: String }
  type Vehicle { id: String, model: String, numberPlate: String }
  
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
                const acc = await BankAccount.create({});
                const lic = await License.create({});
                p = await Player.create({ roblox: String(roblox), account: acc._id, license: lic._id });
            }
            if (!p) return null;
            const data = await Player.findById(p._id).populate('account license properties vehicles').lean();
            
            const res = clean(data);
            if (res.account) res.account = clean(res.account);
            if (res.license) res.license = clean(res.license);
            res.properties = (res.properties || []).map(clean);
            res.vehicles = (res.vehicles || []).map(clean);

            console.log(`📦 Sending Player ${roblox} to Roblox. ID exists: ${!!res.id}`);
            return res;
        },
        organisation: async (_, { id, name, group }) => {
            await connectDB();
            const q = id ? { _id: id } : (group ? { groupId: group } : { name });
            const data = await Organisation.findOne(q).populate('bankAccount').lean();
            if (!data) return null;
            const res = clean(data);
            if (res.bankAccount) res.bankAccount = clean(res.bankAccount);
            return res;
        },
        organisations: async (_, { groups }) => {
            await connectDB();
            const list = await Organisation.find({ groupId: { $in: groups } }).populate('bankAccount').lean();
            return list.map(o => {
                const r = clean(o);
                if (r.bankAccount) r.bankAccount = clean(r.bankAccount);
                return r;
            });
        }
    },
    Mutation: {
        updatePlayer: async (_, { id, cash }) => {
            await connectDB();
            const p = await Player.findByIdAndUpdate(id, { cash }, { new: true }).lean();
            return clean(p);
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