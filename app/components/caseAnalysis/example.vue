<template>
  <div>
    <div class="p-4">
      <div class="text-base font-bold text-muted-foreground">✨ 或者你可以点击下方案例体验分析流程</div>

      <div class="grid gap-4 mt-2 grid-cols-1 sm:grid-cols-2">
        <Card v-for="example in examples" :key="example.id" class="p-4 shadow-none rounded-md hover:ring-1 hover:ring-primary hover:bg-primary/2 transition-all duration-300">
          <CardHeader class="p-0">
            <CardTitle class="line-clamp-1 text-sm font-bold">{{ example.title }}</CardTitle>
            <CardDescription class="line-clamp-2">{{ example.description }}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
const examples = [
  {
    id: 1,
    title: "消费者诉健身房清算责任纠纷",
    description: `我叫王某月，今天来是想向您咨询一件烦心事，希望能得到您的法律帮助。
事情是这样的：我之前是“北京日某健康管理有限公司”开的一家瑜伽馆的会员。为了方便，我在这家店里办了张充值卡，前后也续过几次费。
去年（2023年）10月份的时候，我像往常一样想去上瑜伽课，结果到了店门口才发现，店铺已经关门了，门上贴着转租或者关闭的通知，里面也早就搬空了。我当时就蒙了，赶紧查了一下我的会员卡，发现卡里还有8260块钱的余额没用完。
我试着联系店铺原来的负责人，但电话要么打不通，要么就是互相推诿。后来我费了很大劲才打听到，这家公司的法人和股东已经变了。
我了解到，这家公司的原老板叫刘某。就在去年9月，他把公司100%的股权都转给了一个叫薛某亮的人。这个薛某亮，我后来听说他是个“职业闭店人”，专门接手这种快要倒闭的店，帮原老板“甩锅”。他们签的转让协议我没见过，但听说里面根本没写股权转让要付多少钱，感觉就像是白送一样。
更气人的是，这个薛某亮刚接手公司没几天，就在9月底把这家公司给注销掉了。在注销的时候，他还向市场监管部门承诺说，公司的所有债务，包括我们这些会员的钱，都已经清理干净了。他还提交了一份《清算报告》，说公司登报公告了注销信息，也结清了所有钱款。
但我后来了解到，这全是假的！他们根本没有在报纸上发过什么注销公告，也没有正经地成立清算组来处理我们这些会员的退款事宜。那个《清算公告》应该也是他伪造的！我的8260块钱就这么不明不白地被“清算”掉了。
那个薛某亮现在还辩解说，他只是提供个服务，不该他赔钱，还说我们的会员权益被别的美容美发店接手了。这完全是胡说八道，我办的是瑜伽卡，跟美容美发有什么关系？也从来没有任何人联系我，告诉我所谓的“承接方案”。
现在的情况是，原来的老板刘某通过股权转让跑了，新老板薛某亮通过恶意注销公司也想脱身。我的钱就卡在中间，不知道该找谁要。
律师，我觉得这个薛某亮就是和原老板串通好了，通过虚假注销的方式来逃避债务，坑我们这些消费者的钱。所以，我今天来就是想委托您，起诉这个薛某亮，让他把我的会员卡余额8260块钱退给我。希望您能帮我讨回公道！

`,
  },
  {
    id: 2,
    title: "案例2",
    description: "案例2描述",
  },
  {
    id: 3,
    title: "案例3",
    description: "案例3描述",
  },
  {
    id: 4,
    title: "案例4",
    description: "案例4描述",
  },
];
</script>

<style></style>
