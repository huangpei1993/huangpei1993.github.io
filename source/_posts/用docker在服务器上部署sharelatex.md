---
title: 用docker在服务器上部署sharelatex
date: 2023-11-15 11:02:09
tags:
---
# 重新打包sharelatex的docker镜像
参考官方给出的docker-compose.yaml文件。但是直接docker-compose，并不能排版中文，原因是缺少xelatex相关包。但在docker容器中，安装包并不方便。这里直接以原始sharelatex的docker镜像为基础生成新的docker镜像。

在新的docker镜像中会安装texlive的更新，并且将xelatex相关包添加到环境变量中去。对应的Dockerfile：
```
FROM sharelatex/sharelatex
RUN tlmgr option repository https://mirrors.tuna.tsinghua.edu.cn/CTAN/systems/texlive/tlnet
RUN tlmgr update --self --all
RUN tlmgr install scheme-full
RUN echo '$#! /bin/bash\npushd /usr/local/bin\nfor f in `ls /usr/local/texlive/2023/bin/x86_64-linux`\ndo\n[ -f $f ] || ln -s /usr/local/texlive/2023/bin/x86_64-linux/$f $f\ndone' > /overleaf/link.sh
RUN cat /overleaf/link.sh
RUN chmod +x /overleaf/link.sh
RUN bash /overleaf/link.sh
WORKDIR /
ENTRYPOINT ["/sbin/my_init"]
```
在保存Dockerfile的文件夹下，运行docker build生成新的docker镜像：
```
build --tag chinglin/sharelatex:latest --progress=plain . 2>&1 | tee build.log
```
# docker compose运行
修改官方的docker-compose.yml文件后的文件如下：
```
version: '2.2'
services:
    sharelatex:
        restart: always
        # Server Pro users:
        # image: quay.io/sharelatex/sharelatex-pro
        image: hp/sharelatex
        container_name: sharelatex
        depends_on:
            mongo:
                condition: service_healthy
            redis:
                condition: service_started
        ports:
            - 2080:80
        links:
            - mongo
            - redis
        stop_grace_period: 60s
        volumes:
            - ./sharelatex/sharelatex_data:/var/lib/sharelatex
            ########################################################################
            ####  Server Pro: Uncomment the following line to mount the docker  ####
            ####             socket, required for Sibling Containers to work    ####
            ########################################################################
            # - /var/run/docker.sock:/var/run/docker.sock
        environment:

            SHARELATEX_APP_NAME: Overleaf Community Edition

            SHARELATEX_MONGO_URL: mongodb://mongo/sharelatex

            # Same property, unfortunately with different names in
            # different locations
            SHARELATEX_REDIS_HOST: redis
            REDIS_HOST: redis

            ENABLED_LINKED_FILE_TYPES: 'project_file,project_output_file'

            # Enables Thumbnail generation using ImageMagick
            ENABLE_CONVERSIONS: 'true'

            # Disables email confirmation requirement
            EMAIL_CONFIRMATION_DISABLED: 'true'

            # temporary fix for LuaLaTex compiles
            # see https://github.com/overleaf/overleaf/issues/695
            TEXMFVAR: /var/lib/sharelatex/tmp/texmf-var

            ## Set for SSL via nginx-proxy
            #VIRTUAL_HOST: 103.112.212.22

            # SHARELATEX_SITE_URL: http://sharelatex.mydomain.com
            # SHARELATEX_NAV_TITLE: Our ShareLaTeX Instance
            # SHARELATEX_HEADER_IMAGE_URL: http://somewhere.com/mylogo.png
            # SHARELATEX_ADMIN_EMAIL: support@it.com

            # SHARELATEX_LEFT_FOOTER: '[{"text": "Powered by <a href=\"https://www.sharelatex.com\">ShareLaTeX</a> 2016"},{"text": "Another page I want to link to can be found <a href=\"here\">here</a>"} ]'
            # SHARELATEX_RIGHT_FOOTER: '[{"text": "Hello I am on the Right"} ]'

            # SHARELATEX_EMAIL_FROM_ADDRESS: "team@sharelatex.com"

            # SHARELATEX_EMAIL_AWS_SES_ACCESS_KEY_ID:
            # SHARELATEX_EMAIL_AWS_SES_SECRET_KEY:

            # SHARELATEX_EMAIL_SMTP_HOST: smtp.mydomain.com
            # SHARELATEX_EMAIL_SMTP_PORT: 587
            # SHARELATEX_EMAIL_SMTP_SECURE: false
            # SHARELATEX_EMAIL_SMTP_USER:
            # SHARELATEX_EMAIL_SMTP_PASS:
            # SHARELATEX_EMAIL_SMTP_TLS_REJECT_UNAUTH: true
            # SHARELATEX_EMAIL_SMTP_IGNORE_TLS: false
            # SHARELATEX_EMAIL_SMTP_NAME: '127.0.0.1'
            # SHARELATEX_EMAIL_SMTP_LOGGER: true
            # SHARELATEX_CUSTOM_EMAIL_FOOTER: "This system is run by department x"

            # ENABLE_CRON_RESOURCE_DELETION: true

            ################
            ## Server Pro ##
            ################

            # SANDBOXED_COMPILES: 'true'

            # SANDBOXED_COMPILES_SIBLING_CONTAINERS: 'true'
            # SANDBOXED_COMPILES_HOST_DIR: '/var/sharelatex_data/data/compiles'

            # DOCKER_RUNNER: 'false'

            ## Works with test LDAP server shown at bottom of docker compose
            # SHARELATEX_LDAP_URL: 'ldap://ldap:389'
            # SHARELATEX_LDAP_SEARCH_BASE: 'ou=people,dc=planetexpress,dc=com'
            # SHARELATEX_LDAP_SEARCH_FILTER: '(uid={{username}})'
            # SHARELATEX_LDAP_BIND_DN: 'cn=admin,dc=planetexpress,dc=com'
            # SHARELATEX_LDAP_BIND_CREDENTIALS: 'GoodNewsEveryone'
            # SHARELATEX_LDAP_EMAIL_ATT: 'mail'
            # SHARELATEX_LDAP_NAME_ATT: 'cn'
            # SHARELATEX_LDAP_LAST_NAME_ATT: 'sn'
            # SHARELATEX_LDAP_UPDATE_USER_DETAILS_ON_LOGIN: 'true'

            # SHARELATEX_TEMPLATES_USER_ID: "578773160210479700917ee5"
            # SHARELATEX_NEW_PROJECT_TEMPLATE_LINKS: '[ {"name":"All Templates","url":"/templates/all"}]'


            # SHARELATEX_PROXY_LEARN: "true"

    mongo:
        restart: always
        image: mongo:4.4
        container_name: mongo
        expose:
            - 27017
        volumes:
            - ./mongo/mongo_data:/data/db
        healthcheck:
            test: echo 'db.stats().ok' | mongo localhost:27017/test --quiet
            interval: 10s
            timeout: 10s
            retries: 5

    redis:
        restart: always
        image: redis:6.2
        container_name: redis
        expose:
            - 6379
        volumes:
            - ./redis/redis_data:/data

    # ldap:
    #    restart: always
    #    image: rroemhild/test-openldap
    #    container_name: ldap
    #    expose:
    #        - 389

    # See https://github.com/jwilder/nginx-proxy for documentation on how to configure the nginx-proxy container,
    # and https://github.com/overleaf/overleaf/wiki/HTTPS-reverse-proxy-using-Nginx for an example of some recommended
    # settings. We recommend using a properly managed nginx instance outside of the Overleaf Server Pro setup,
    # but the example here can be used if you'd prefer to run everything with docker-compose

    # nginx-proxy:
    #     image: jwilder/nginx-proxy
    #     container_name: nginx-proxy
    #     ports:
    #       #- "80:80"
    #       - "443:443"
    #     volumes:
    #       - /var/run/docker.sock:/tmp/docker.sock:ro
    #       - /home/sharelatex/tmp:/etc/nginx/certs
```
## Mongdb报错问题
参考 https://github.com/overleaf/overleaf/wiki/Release-Notes--4.x.x
### Manually setting up MongoDB as a replica set
The following instructions are not necessary if you use the Overleaf Toolkit or if you use an external Mongo database already configured as a replica set.

If you run MongoDB with docker-compose, add the following command to the mongo container configuration:
```
mongo:
    command: "--replSet overleaf"
```
Restart the mongo container then start a mongo shell with docker-compose exec -it mongo mongo. In that shell, run the following command to initiate the replica set:
```
rs.initiate({ _id: "overleaf", members: [ { _id: 0, host: "mongo:27017" } ] })
```

# 参考
- https://zhuanlan.zhihu.com/p/367416542
- https://github.com/overleaf/overleaf/blob/main/docker-compose.yml