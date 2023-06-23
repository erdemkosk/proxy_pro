const { spawnSync, spawn } = require('child_process');
const AWS = require('aws-sdk');

// AWS kimlik bilgilerinizi ve bölgenizi ayarlayın
AWS.config.update({ region: 'eu-central-1' }); // Uygun bölgeyi seçin

// EC2 örneği oluşturma ve istek yönlendirme işlemini gerçekleştirme fonksiyonu
async function createInstanceAndForwardRequests() {
  try {
    // EC2 örneği oluşturmak için gerekli kodu buraya ekleyin
    const ec2 = new AWS.EC2();

    const vpcs = await ec2.describeVpcs().promise();
    const vpcId = vpcs.Vpcs[0].VpcId;

    // Güvenlik grubunu kontrol et ve oluştur veya mevcutunu kullan
    const securityGroupName = 'reverse-proxy';
    let securityGroupId;

    const describeSecurityGroupsParams = {
      Filters: [
        { Name: 'vpc-id', Values: [vpcId] },
        { Name: 'group-name', Values: [securityGroupName] }
      ]
    };

    const existingSecurityGroups = await ec2.describeSecurityGroups(describeSecurityGroupsParams).promise();

    if (existingSecurityGroups.SecurityGroups.length > 0) {
      console.log(`Mevcut güvenlik grubu '${securityGroupName}' bulundu.`);
      securityGroupId = existingSecurityGroups.SecurityGroups[0].GroupId;
    } else {
      console.log(`Güvenlik grubu '${securityGroupName}' oluşturuluyor...`);
      const createSecurityGroupParams = {
        Description: 'Reverse Proxy',
        GroupName: securityGroupName,
        VpcId: vpcId
      };

      const securityGroup = await ec2.createSecurityGroup(createSecurityGroupParams).promise();
      securityGroupId = securityGroup.GroupId;
      console.log(`Güvenlik grubu '${securityGroupName}' oluşturuldu:`, securityGroupId);
    }

    // SSH trafiğine izin verme
    console.log('SSH trafiği için izin veriliyor...');
    const sshIngressResult = spawnSync('aws', ['ec2', 'authorize-security-group-ingress', '--group-id', securityGroupId, '--protocol', 'tcp', '--port', '22', '--cidr', 'YOUR_IP/32', '--no-cli-pager']);
    console.log('SSH trafiği için izin verildi:', sshIngressResult.stdout.toString());

    // HTTP trafiğine izin verme
    console.log('HTTP trafiği için izin veriliyor...');
    const httpIngressResult = spawnSync('aws', ['ec2', 'authorize-security-group-ingress', '--group-id', securityGroupId, '--protocol', 'tcp', '--port', '80', '--cidr', '0.0.0.0/0', '--no-cli-pager']);
    console.log('HTTP trafiği için izin verildi:', httpIngressResult.stdout.toString());

    // EC2 örneği için parametreleri ayarlayın
    const params = {
      ImageId: 'ami-0b2ac948e23c57071', // uygun bir AMI ID'si girin
      InstanceType: 't2.micro',
      MinCount: 1,
      MaxCount: 1,
      SecurityGroupIds: [securityGroupId],
    };

    // EC2 örneğini oluşturun
    console.log('EC2 örneği oluşturuluyor...');
    const data = await ec2.runInstances(params).promise();
    const instanceId = data.Instances[0].InstanceId;
    console.log('EC2 örneği oluşturuldu:', instanceId);

    // EC2 örneğinin durumunu izleyin
    console.log('EC2 örneği başlatılıyor...');
    await ec2.waitFor('instanceRunning', { InstanceIds: [instanceId] }).promise();
    console.log('EC2 örneği başlatıldı.');

    // EC2 örneğinin IP adresini alın
    console.log('EC2 IP adresi alınıyor...');
    const describeParams = { InstanceIds: [instanceId] };
    const describeData = await ec2.describeInstances(describeParams).promise();
    const ipAddress = describeData.Reservations[0].Instances[0].PublicIpAddress;
    console.log('EC2 IP adresi:', ipAddress);

    // SSH aracılığıyla EC2 örneğine bağlanarak Nginx'i kurulumunu gerçekleştirin
    console.log('Nginx kurulumu gerçekleştiriliyor...');
    const userData = `#!/bin/bash
sudo amazon-linux-extras install -y nginx

cat <<EOT > /etc/nginx/nginx.conf
upstream tunnel {
  server 127.0.0.1:80;
}

server {
  server_name ${ipAddress};

  location / {
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Host $http_host;
    proxy_redirect off;

    proxy_pass http://tunnel;
  }
}
EOT

sudo systemctl restart nginx
`;

    console.log('Kullanıcı verileri yazılıyor...');
    const userDataResult = spawnSync('ssh', [`ec2-user@${ipAddress}`, 'echo', `'${userData}'`, '>', 'userdata.sh']);
    console.log('Kullanıcı verileri yazıldı:', userDataResult.stdout.toString());

    console.log('Dosya izinleri ayarlanıyor...');
    const chmodResult = spawnSync('ssh', [`ec2-user@${ipAddress}`, 'chmod', '+x', 'userdata.sh']);
    console.log('Dosya izinleri ayarlandı:', chmodResult.stdout.toString());

    console.log('Nginx kurulumu yapılıyor...');
    const nginxResult = spawnSync('ssh', [`ec2-user@${ipAddress}`, 'sudo', './userdata.sh']);
    console.log('Nginx kurulumu tamamlandı:', nginxResult.stdout.toString());

    console.log('SSH tüneli oluşturuluyor...');
    const tunnel = spawn('ssh', ['-o', 'ServerAliveInterval=60', '-N', '-R', '80:localhost:3000', `ec2-user@${ipAddress}`]);

tunnel.stdout.on('data', (data) => {
  console.log('SSH tüneli oluşturuldu:', data.toString());
});

tunnel.stderr.on('data', (data) => {
  console.error('Hata:', data.toString());
});

tunnel.on('close', (code) => {
  console.log(`Tünel kapatıldı, çıkış kodu: ${code}`);
});

  } catch (err) {
    console.error('Hata:', err);
  }
}

createInstanceAndForwardRequests();
