const express = require("express");
const app = express();
const cors = require("cors");
const jwt = require('jsonwebtoken')
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY)
const port = process.env.PORT || 5001;

// MiddleWare :
app.use(cors());
app.use(express.json());
// DB -    - qcAdIKDIe59qPMto


// own middleware 
const verifyToken = (req,res,next)=>{
  console.log('token in the middleware', req.headers.authorization);
  if(!req.headers.authorization){
    return res.status(401).send({message: "Forbidden Access"})
  }
  const token = req.headers.authorization.split(' ')[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECURE, (err, decoded)=>{
    if(err){
      return res.status(401).send({message: "Forbidden Access"})
    }
    req.decoded = decoded;
    next()
  })
}




const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.guubgk2.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const usersCollection = client.db("bistroDB").collection("users");
    const menuCollection = client.db("bistroDB").collection("menu");
    const reviewCollection = client.db("bistroDB").collection("reviews");
    const cartCollection = client.db("bistroDB").collection("carts");
    const paymentCollection = client.db("bistroDB").collection("payments");

    const verifyAdmin = async(req,res,next)=>{
      const email = req.decoded.email;
      const query = {email : email};
      const user = await usersCollection.findOne(query);
      const isAdmin = user?.role === "admin"
      if(!isAdmin){
        return res.status(403).send({message: "Forbidden"})
      }
      next()
    }

    // Stripe Payment Intent
    app.post('/create-payment-intent', async(req,res)=>{
      const {price} = req.body;
      const amount = parseFloat(price * 100);
      console.log(amount, "amount inside the intendt");
      const paymentIntent = await stripe.paymentIntents.create({
        amount : amount,
        currency : "usd",
        payment_method_types : ['card']
      })
      res.send({
        clientSecret : paymentIntent.client_secret,
      })
    })

    app.post("/payments", async(req,res)=>{
      const payment = req.body;
      const paymentResult = await paymentCollection.insertOne(payment)
      console.log('payment info', payment);
      // finding out the carts id according to paymenet body req. and delete the orders
      const query = {_id:{
        $in: payment.cartIds.map(id => new ObjectId(id))
      }}
      const deleteResult = await cartCollection.deleteMany(query)
      res.send({paymentResult, deleteResult})

    })

    app.get("/payments/:email", verifyToken, async(req,res)=>{
      const email = req.params.email;
      const query = {email : email};
      if(req.params.email !== req.decoded.email){
        res.status(401).send({message : "Forbidden Access"})
      }
      const result = await paymentCollection.find(query).toArray();
      res.send(result)
    })

    // Admin Stats api 
    app.get("/admin-stats",verifyToken, verifyAdmin, async(req,res)=>{
      const users = await usersCollection.estimatedDocumentCount();
      const menuItems = await menuCollection.estimatedDocumentCount();
      const orders = await paymentCollection.estimatedDocumentCount();
      //finding out the revenue but not the best way
      // const paymenets = await paymentCollection.find().toArray();
      // const revenue = paymenets.reduce((prev, payment)=> prev+payment.price,0)
      const result = await paymentCollection.aggregate([
        {
          $group:{
            _id : null,
            totalRevenue : {
              $sum: "$price"
            }
          }
        }
      ]).toArray();

      const revenue = result.length > 0 ? result[0].totalRevenue : 0;



      res.send({
        users,
        menuItems,
        orders,
        revenue
      })
    }) 





    // JWT Related API
    app.post('/jwt', async(req,res)=>{
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECURE, {expiresIn: '1h'})
      res.send({token})
    })
    

    // user related api's here
    app.get("/users", verifyToken, verifyAdmin, async(req,res)=>{
      const result = await usersCollection.find().toArray();
      res.send(result)
    })

    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = {email : user.email}
      const existingUser = await usersCollection.findOne(query)
      if(existingUser){
        return res.send({message:"User already exists", insertedId: null})
      }
      const result = await usersCollection.insertOne(user);
      res.send(result)
    });

    app.patch("/user/admin/:id", verifyToken, verifyAdmin, async(req,res)=>{
      const id = req.params.id;
      const filter = {_id: new ObjectId(id)}
      const updatedDoc = {
        $set :{
          role : "admin"
        }
      }
      const result = await usersCollection.updateOne(filter, updatedDoc)
      res.send(result)
    })

    app.delete("/users/:id", verifyToken, verifyAdmin, async(req,res) => {
      const id = req.params.id;
      const query = {_id: new ObjectId(id)}
      const result = await usersCollection.deleteOne(query)
      res.send(result)
    })


    app.get('/users/isadmin/:email', verifyToken, async(req, res)=>{
      const email = req.params.email;
      if(email !== req.decoded.email){
        return res.status(403).send({message: "Unauthorized"})
      }
      const query = {email : email};
      const user = await usersCollection.findOne(query);
      let admin = false;
      if(user){
        admin = user?.role === "admin"
      }
      res.send({admin})
    })


// Menu related api's here
    app.get("/menu", async (req, res) => {
      try {
        const result = await menuCollection.find().toArray();
        res.send(result);
      } catch (error) {
        console.log(error);
      }
    });
    // to update menu 
    app.get("/menu/:id", async(req,res)=>{
      const id = req.params.id;
      const query = {_id : id}
      const result = await menuCollection.findOne(query)
      res.send(result)
    })
    app.patch("/menu/:id", async(req,res)=>{
      const item = req.body;
      const id = req.params.id;
      const filter = {_id : id};
      const updatedDoc = {
        $set:{
          name : item.name,
          price : item.price,
          category : item.category,
          recipe : item.recipe,
          image : item.image
        }
      }
      const result = await menuCollection.updateOne(filter, updatedDoc);
      res.send(result)      

    })
    // to add menu item
    app.post("/menu",verifyToken, verifyAdmin, async(req,res)=>{
      const item = req.body;
      const result = await menuCollection.insertOne(item);
      res.send(result)
    })
    
    app.delete("/menu/:id", verifyToken, verifyAdmin, async(req,res)=>{
      const id = req.params.id;
      const query = {_id: new ObjectId(id)}
      const result = await menuCollection.deleteOne(query)
      res.send(result)
    })

    app.get("/reviews", async (req, res) => {
      try {
        const result = await reviewCollection.find().toArray();
        res.send(result);
      } catch (error) {
        console.log(error);
      }
    });

    app.get("/carts", async (req, res) => {
      const email = req.query.email;
      console.log(email);
      const query = { email: email };
      const result = await cartCollection.find(query).toArray();
      res.send(result);
      console.log(result);
    });

    app.post("/carts", async (req, res) => {
      const cartItems = req.body;
      const result = await cartCollection.insertOne(cartItems);
      res.send(result);
    });

    app.delete("/carts/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartCollection.deleteOne(query);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Bistro Boss Server is On Serving");
});

app.listen(port, () => {
  console.log(`Bistro Boss Server is running on port ${port}`);
});
