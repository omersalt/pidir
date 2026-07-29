FROM python:3.12-slim
WORKDIR /uygulama
COPY app.py .
ENV PIDIR_TLM_VERI=/veri PIDIR_TLM_PORT=8099
EXPOSE 8099
CMD ["python", "-u", "app.py"]
