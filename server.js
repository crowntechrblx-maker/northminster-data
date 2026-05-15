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
    } catch (error) { console.error("❌ MongoDB Error:", error); }
}

const app = express();
app.use(express.json());

// MODELS
const Player = mongoose.models.Player || mongoose.model('Player', new mongoose.Schema({ roblox: { type: String, unique: true }, cash: { type: Number, default: 500 }, account: { type: mongoose.Schema.Types.ObjectId, ref: 'BankAccount' }, license: { type: mongoose.Schema.Types.ObjectId, ref: 'License' }, properties: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Property' }], vehicles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle' }] }));
const BankAccount = mongoose.models.BankAccount || mongoose.model('BankAccount', new mongoose.Schema({ balance: { type: Number, default: 1000 } }));
const License = mongoose.models.License || mongoose.model('License', new mongoose.Schema({ hasTheory: { type: Boolean, default: false }, categories: Array }));
const Organisation = mongoose.models.Organisation || mongoose.model('Organisation', new mongoose.Schema({ name: String, groupId: String, discoverable: Boolean, bankAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'BankAccount' } }));
const Vehicle = mongoose.models.Vehicle || mongoose.model('Vehicle', new mongoose.Schema({ numberPlate: String, model: String }));
const Property = mongoose.models.Property || mongoose.model('Property', new mongoose.Schema({ location: String }));

// AGGRESSIVE ID MAPPING
const clean = (doc) => {
    if (!doc) return null;
    let obj = doc.toObject ? doc.toObject() : JSON.parse(JSON.stringify(doc));
    if (obj._id) obj.id = obj._id.toString();
    return obj;
};

const typeDefs = gql`
  scalar ObjectID
  scalar JSON
  type Account { id: ObjectID, balance: Int }
  type License { id: ObjectID, hasTheory: Boolean, categories: [JSON] }
  type Player { id: ObjectID, roblox: String, cash: Int, account: Account, license: License, properties: [Property], vehicles: [Vehicle] }
  type Organisation { id: ObjectID, name: String, groupId: String, bankAccount: Account }
  type Property { id: ObjectID, location: String }
  type Vehicle { id: ObjectID, model: String, numberPlate: String }
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
                const acc = await BankAccount.create({});
                const lic = await License.create({});
                p = await Player.create({ roblox: String(roblox), account: acc._id, license: lic._id });
            }
            if (!p) return null;
            const data = await Player.findById(p._id).populate('account license properties vehicles');
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
            const data = await Organisation.findOne(q).populate('bankAccount');
            if (!data) return null;
            let res = clean(data);
            if (res.bankAccount) res.bankAccount = clean(res.bankAccount);
            return res;
        },
        organisations: async (_, { groups }) => {
            await connectDB();
            const list = await Organisation.find({ groupId: { $in: groups } }).populate('bankAccount');
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