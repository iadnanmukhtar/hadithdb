'use strict';
const router=require('../routes/update');
const Editing=require('../lib/BookTocEditing');
const Auth=require('../lib/GoogleAuth');
const UserSettings=require('../lib/UserSettings');
const Books=require('../lib/Books');
function handlers(method) {return router.stack.find(l=>l.route?.path==='/book-toc/:bookId'&&l.route.methods[method]).route.stack.map(l=>l.handle);}
afterEach(()=>jest.restoreAllMocks());
test.each(['get','post'])('%s requires a verified administrator',async method=>{
 jest.spyOn(Auth,'verifyRequest').mockResolvedValue({uid:'reader',admin:false});
 jest.spyOn(UserSettings,'isAdminUser').mockResolvedValue(false);
 const next=jest.fn();await handlers(method)[0]({params:{}},{},next);
 expect(next.mock.calls[0][0].status).toBe(403);
});
test('GET loads only the authorized book with no-store',async()=>{
 jest.spyOn(Editing,'list').mockResolvedValue({book:{id:7},headings:[],items:[],revision:'r'});
 const res={set:jest.fn(),json:jest.fn()};
 await handlers('get')[1]({params:{bookId:'7'}},res,jest.fn());
 expect(Editing.list).toHaveBeenCalledWith('7');expect(res.set).toHaveBeenCalledWith('Cache-Control','no-store');
});
test('committed changes with failed refresh are reported as saved, not retryable writes',async()=>{
 jest.spyOn(Editing,'mutate').mockResolvedValue({book:{id:7,alias:'example'},hadithIds:[]});
 jest.spyOn(Books,'touchBookContentLastmodById').mockRejectedValue(new Error('offline'));
 const res={json:jest.fn()},next=jest.fn();
 await handlers('post')[1]({params:{bookId:'7'},body:{action:'add'},user:{uid:'admin'}},res,next);
 expect(res.json).toHaveBeenCalledWith(expect.objectContaining({code:200,refreshPending:true}));expect(next).not.toHaveBeenCalled();
});
test('validation failures return the actionable message to the organizer',async()=>{
 jest.spyOn(Editing,'mutate').mockRejectedValue(require('http-errors')(409,'Move the items first'));
 const res={status:jest.fn().mockReturnThis(),json:jest.fn()};
 await handlers('post')[1]({params:{bookId:'7'},body:{action:'delete'},user:{uid:'admin'}},res,jest.fn());
 expect(res.status).toHaveBeenCalledWith(409);expect(res.json).toHaveBeenCalledWith({message:'Move the items first'});
});
