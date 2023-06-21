const { spawn } = require('child_process');
const AWS = require('aws-sdk');

// AWS kimlik bilgilerinizi ve bölgenizi ayarlayın
AWS.config.update({ region: 'eu-central-1' }); // Uygun bölgeyi seçin

// EC2 örneği oluşturma ve istek yönlendirme işlemini gerçekleştirme fonksiyonu
async function createInstanceAndForwardRequests() {
  try {
    // EC2 örneği oluşturmak için gerekli kodu buraya ekleyin
    const ec2 = new AWS.EC2();

    // EC2 örneği için parametreleri ayarlayın
    const params = {
      ImageId: 'ami-0b2ac948e23c57071', // uygun bir AMI ID'si girin
      InstanceType: 't2.micro',
      MinCount: 1,
      MaxCount: 1,
      //UserData: userData
    };

    // EC2 örneğini oluşturun
    const data = await ec2.runInstances(params).promise();
    const instanceId = data.Instances[0].InstanceId;

    // EC2 örneğinin durumunu izleyin
    await ec2.waitFor('instanceRunning', { InstanceIds: [instanceId] }).promise();

    // EC2 örneğinin IP adresini alın
    const describeParams = { InstanceIds: [instanceId] };
    const describeData = await ec2.describeInstances(describeParams).promise();
    const ipAddress = describeData.Reservations[0].Instances[0].PublicIpAddress;

    console.log('EC2 URL:', ipAddress);

    // İstekleri yerel bilgisayara yönlendiren bir HTTP sunucusu oluşturun
    const server = spawn('ssh', ['-N', '-R', '80:localhost:3000', `ec2-user@${ipAddress}`]);

    // Sunucu çıktılarını konsola yönlendirin
    server.stdout.on('data', (data) => {
      console.log(data.toString());
    });

    server.stderr.on('data', (data) => {
      console.error(data.toString());
    });

    server.on('close', (code) => {
      console.log(`SSH sunucusu kapandı. Çıkış kodu: ${code}`);

      // EC2 örneğini sonlandırın
      ec2.terminateInstances({ InstanceIds: [instanceId] }).promise();
    });
  } catch (err) {
    console.error('Bir hata oluştu:', err);
  }
}

// EC2 örneği oluşturma ve istek yönlendirme işlemini başlatma
createInstanceAndForwardRequests();
